import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { configuredButtons, infobipMessageId, infobipRequest, parseHeader, parseInfobipWebhook, parseTemplate, templateButtons } from '../supabase/functions/_shared/infobip'

const migration = readFileSync('supabase/migrations/20261013190000_crm_channel_consents_v1.sql', 'utf8')
const dispatcher = readFileSync('supabase/functions/crm-channel-outbox-dispatcher/index.ts', 'utf8')
const webhook = readFileSync('supabase/functions/crm-channel-infobip-webhook/index.ts', 'utf8')

const send = { baseUrl: 'abc123.api.infobip.com', apiKey: 'k', from: '+55 11 4000-0000', to: '+55 (11) 99999-0000', messageId: 'outbox-1', body: 'Oi' }

describe('Infobip WhatsApp adapter', () => {
  it('sends free text with our outbox id as messageId', () => {
    const { url, init } = infobipRequest(send)
    expect(url).toBe('https://abc123.api.infobip.com/whatsapp/1/message/text')
    expect((init.headers as Record<string, string>).authorization).toBe('App k')
    expect(JSON.parse(String(init.body))).toEqual({ from: '551140000000', to: '5511999990000', messageId: 'outbox-1', content: { text: 'Oi' } })
  })

  it('sends approved templates when the outbox row asks for one', () => {
    const template = parseTemplate({ whatsapp_template: { name: 'carrinho_abandonado', placeholders: ['Ana', 42] } })
    const { url, init } = infobipRequest({ ...send, template, notifyUrl: 'https://x/hook' })
    expect(url).toBe('https://abc123.api.infobip.com/whatsapp/1/message/template')
    const message = JSON.parse(String(init.body)).messages[0]
    expect(message.content).toEqual({ templateName: 'carrinho_abandonado', templateData: { body: { placeholders: ['Ana', '42'] } }, language: 'pt_BR' })
    expect(message.notifyUrl).toBe('https://x/hook')
    expect(infobipMessageId({ messages: [{ messageId: 'outbox-1' }] })).toBe('outbox-1')
  })

  it('sends the header media of MEDIA_TEMPLATEs (otherwise Infobip 7008)', () => {
    const image = { ...parseTemplate({ whatsapp_template: { name: 'confronto_perfeito_elton' } })!, header: parseHeader('image', 'https://cdn.x/banner.jpg') }
    expect(JSON.parse(String(infobipRequest({ ...send, template: image }).init.body)).messages[0].content.templateData)
      .toEqual({ body: { placeholders: [] }, header: { type: 'IMAGE', mediaUrl: 'https://cdn.x/banner.jpg' } })
    const doc = { ...image, header: parseHeader('DOCUMENT', 'https://cdn.x/files/Guia%20Final.pdf') }
    expect(JSON.parse(String(infobipRequest({ ...send, template: doc }).init.body)).messages[0].content.templateData.header)
      .toEqual({ type: 'DOCUMENT', mediaUrl: 'https://cdn.x/files/Guia%20Final.pdf', filename: 'Guia Final.pdf' })
    expect(parseHeader('IMAGE', 'http://insecure/x.jpg')).toBeNull()
    expect(dispatcher).toContain('whatsapp_header_type,whatsapp_header_url')
  })

  it('sends the quick-reply buttons of the approved template (otherwise Infobip 7008)', () => {
    const definition = { templates: [{ name: 'confronto_perfeito_elton', language: 'pt_BR', structure: { body: { text: 'Olá, aliado.' }, buttons: [
      { type: 'URL', text: 'Quebrar o Ciclo', url: 'https://x.com/quiz' }, { type: 'QUICK_REPLY', text: 'Bloquear Contato' }] } }] }
    const buttons = templateButtons(definition, 'confronto_perfeito_elton', 'pt_BR')
    expect(buttons).toEqual([{ type: 'QUICK_REPLY', parameter: 'Bloquear Contato' }])
    const template = { ...parseTemplate({ whatsapp_template: { name: 'confronto_perfeito_elton' } })!, buttons }
    expect(JSON.parse(String(infobipRequest({ ...send, template }).init.body)).messages[0].content).toEqual({
      templateName: 'confronto_perfeito_elton', language: 'pt_BR',
      templateData: { body: { placeholders: [] }, buttons: [{ type: 'QUICK_REPLY', parameter: 'Bloquear Contato' }] },
    })
    expect(templateButtons(null, 'x', 'pt_BR')).toEqual([])
  })

  it('per-template configured buttons win over the Infobip definition', () => {
    expect(configuredButtons([{ type: 'QUICK_REPLY', parameter: ' sair ' }, { type: 'url', parameter: 'abc123' }, { type: 'CALL', parameter: 'x' }]))
      .toEqual([{ type: 'QUICK_REPLY', parameter: 'sair' }, { type: 'URL', parameter: 'abc123' }])
    expect(configuredButtons(null)).toBeNull()
    expect(configuredButtons([])).toBeNull()
    expect(dispatcher).toContain('configuredButtons(found.data?.whatsapp_buttons) ?? await infobipTemplateButtons')
  })

  it('refuses base URLs outside Infobip (credential exfiltration)', () => {
    expect(() => infobipRequest({ ...send, baseUrl: 'https://evil.example.com' })).toThrow('infobip_base_url_invalid')
    expect(() => infobipRequest({ ...send, baseUrl: 'http://abc.api.infobip.com' })).toThrow('infobip_base_url_invalid')
  })

  it('parses inbound messages, delivery and seen reports', () => {
    const events = parseInfobipWebhook({ results: [
      { from: '5511999990000', to: '551140000000', messageId: 'in-1', message: { type: 'TEXT', text: ' SAIR ' }, contact: { name: 'Ana' } },
      { messageId: 'outbox-1', status: { groupName: 'DELIVERED' }, error: { name: 'NO_ERROR' } },
      { messageId: 'outbox-2', status: { groupName: 'UNDELIVERABLE', name: 'UNDELIVERABLE_NOT_DELIVERED' }, error: { name: 'EC_ABSENT_SUBSCRIBER' } },
      { messageId: 'outbox-1', seenAt: '2026-10-13T00:00:00Z' },
      { messageId: 'x', message: { type: 'IMAGE' }, from: '5511' },
      { status: { groupName: 'DELIVERED' } },
    ] })
    expect(events).toEqual([
      { kind: 'message', from: '5511999990000', to: '551140000000', messageId: 'in-1', text: 'SAIR', name: 'Ana', type: 'text' },
      { kind: 'status', messageId: 'outbox-1', status: 'delivered', error: null },
      { kind: 'status', messageId: 'outbox-2', status: 'failed', error: 'EC_ABSENT_SUBSCRIBER' },
      { kind: 'status', messageId: 'outbox-1', status: 'read', error: null },
    ])
    expect(parseInfobipWebhook(null)).toEqual([])
  })
})

describe('dispatcher routing and consent', () => {
  it('routes WhatsApp through Infobip or Baileys, never Meta', () => {
    expect(dispatcher).toContain('provider === "infobip" && account.channel === "whatsapp"')
    expect(dispatcher).not.toContain('"meta_whatsapp"')
    expect(dispatcher).not.toContain('messaging_product: "whatsapp"')
  })

  it('blocks opted-out recipients before delivery, without retry', () => {
    expect(dispatcher.indexOf('crm_channel_recipient_opted_out')).toBeLessThan(dispatcher.indexOf('const delivery = await deliver('))
    expect(dispatcher).toMatch(/"recipient_opted_out",\n/)
  })

  it('webhook authenticates by per-account token before touching data', () => {
    expect(webhook).toContain('safeEqual(token, expected)')
    expect(webhook.indexOf('safeEqual(token, expected)')).toBeLessThan(webhook.indexOf('crm_ingest_channel_message'))
  })
})

describe('consent migration', () => {
  it('is org-scoped, read-only for members, and checked by a service-role RPC', () => {
    expect(migration).toContain('unique (organization_id, channel, address)')
    expect(migration).toContain("private.has_org_capability(organization_id, 'can_view_chats')")
    expect(migration).toContain('revoke all on public.crm_channel_consents from anon, authenticated;')
    expect(migration).toContain('grant execute on function public.crm_channel_recipient_opted_out(uuid, text, text) to service_role;')
  })

  it('opts out on inbound keywords for every WhatsApp/SMS provider via a crm_messages trigger', () => {
    expect(migration).toContain("when (new.direction = 'inbound' and new.channel in ('whatsapp', 'sms'))")
    expect(migration).toContain("'SAIR', 'PARAR', 'STOP'")
    expect(migration).toContain("'VOLTAR', 'START'")
  })
})

describe('CRM metadata redaction', () => {
  it('does not clash with the plpgsql variable named value when metadata has arrays', () => {
    const fix = readFileSync('supabase/migrations/20261022235900_fix_redact_crm_metadata_ambiguous_value_v1.sql', 'utf8')
    expect(fix).toContain('for item in select e from jsonb_array_elements(input) as e')
  })
})
