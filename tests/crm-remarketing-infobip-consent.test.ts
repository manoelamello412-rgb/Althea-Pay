import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTemplateData, configuredTemplateData, findTemplate, infobipMessageId, infobipRequest, parseInfobipWebhook, parseTemplate } from '../supabase/functions/_shared/infobip'

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

  // Approved structures shaped like Infobip's GET /whatsapp/2/senders/{sender}/templates (WhatsApp*ApiData).
  const approved = (structure: Record<string, unknown>, category = 'MARKETING') => ({ templates: [{ name: 't', language: 'pt_BR', category, structure }] })
  const build = (structure: Record<string, unknown>, configured = {}, placeholders: string[] = [], category?: string) =>
    buildTemplateData(findTemplate(approved(structure, category), 't', 'pt_BR'), configured, placeholders, new Date('2026-10-23T00:00:00Z'))

  it('confronto_perfeito_elton: quick reply gets an entry, static URL button does not (Infobip sample JSON)', () => {
    expect(build({ body: { text: 'Olá, aliado.' }, buttons: [{ type: 'URL', text: 'Quebrar o Ciclo', url: 'https://x.com/quiz' }, { type: 'QUICK_REPLY', text: 'Bloquear Contato' }] }))
      .toEqual({ buttons: [{ type: 'QUICK_REPLY', parameter: 'Bloquear Contato' }] })
  })

  it('fills every header type and send-time button from the approved examples', () => {
    expect(build({ header: { format: 'IMAGE', example: 'https://cdn/x.jpg' } })).toEqual({ header: { type: 'IMAGE', mediaUrl: 'https://cdn/x.jpg' } })
    expect(build({ header: { format: 'DOCUMENT', example: 'https://cdn/Guia%20Final.pdf' } }).header).toEqual({ type: 'DOCUMENT', mediaUrl: 'https://cdn/Guia%20Final.pdf', filename: 'Guia Final.pdf' })
    expect(build({ header: { format: 'VIDEO', example: 'https://cdn/v.mp4' } }).header).toEqual({ type: 'VIDEO', mediaUrl: 'https://cdn/v.mp4' })
    expect(build({ header: { format: 'TEXT', text: 'Oi {{1}}', example: 'Ana' } }).header).toEqual({ type: 'TEXT', placeholder: 'Ana' })
    expect(build({ header: { format: 'TEXT', text: 'Oferta' } })).toEqual({})
    expect(build({ buttons: [
      { type: 'URL', text: 'Pagar', url: 'https://pay.x/{{1}}', example: 'abc' }, { type: 'COPY_CODE', text: 'Copiar', example: 'CUPOM10' },
      { type: 'FLOW', text: 'Abrir', flowId: 1 }, { type: 'PHONE_NUMBER', text: 'Ligar', phoneNumber: '+55' }, { type: 'VOICE_CALL', text: 'Chamar' },
    ] }).buttons).toEqual([{ type: 'URL', parameter: 'abc' }, { type: 'COPY_CODE', parameter: 'CUPOM10' }, { type: 'FLOW' }, { type: 'VOICE_CALL' }])
  })

  it('covers carousel, limited-time offer and authentication templates', () => {
    expect(build({ body: { text: 'x' }, carousel: { cards: [
      { header: { format: 'IMAGE', example: 'https://cdn/1.jpg' }, body: { text: 'c' }, buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }] },
      { header: { format: 'VIDEO', example: 'https://cdn/2.mp4' }, body: { text: 'd {{1}}', examples: ['10'] }, buttons: [{ type: 'URL', text: 'Ver', url: 'https://x/{{1}}', example: 'p2' }] },
    ] } }).carousel).toEqual({ cards: [
      { body: { placeholders: [] }, header: { type: 'IMAGE', mediaUrl: 'https://cdn/1.jpg' }, buttons: [{ type: 'QUICK_REPLY', parameter: 'Quero' }] },
      { body: { placeholders: ['10'] }, header: { type: 'VIDEO', mediaUrl: 'https://cdn/2.mp4' }, buttons: [{ type: 'URL', parameter: 'p2' }] },
    ] })
    expect(build({ limitedTimeOffer: { hasExpiration: true, text: 'Só hoje' } }).limitedTimeOffer).toEqual({ expirationTime: '2026-10-24T00:00:00.000Z' })
    expect(build({ body: { text: '{{1}} é seu código' } }, {}, ['123456'], 'AUTHENTICATION')).toEqual({ buttons: [{ type: 'URL', parameter: '123456' }] })
  })

  it('configured values win and may use the template variables ({{n}})', () => {
    const configured = configuredTemplateData({
      whatsapp_header_type: 'LOCATION', whatsapp_header_url: '-23.5, -46.6',
      whatsapp_buttons: [{ type: 'url', parameter: '{{2}}' }, { type: 'FLOW', parameter: 'tok' }, { type: 'QUICK_REPLY', parameter: '' }],
      whatsapp_template_data: { limitedTimeOffer: { expirationTime: '2026-12-31T23:59:00Z' } },
    })
    expect(build({ header: { format: 'LOCATION' }, buttons: [{ type: 'QUICK_REPLY', text: 'auto' }] }, configured, ['Ana', 'chk_42'])).toEqual({
      header: { type: 'LOCATION', latitude: -23.5, longitude: -46.6 },
      buttons: [{ type: 'URL', parameter: 'chk_42' }, { type: 'FLOW', flowToken: 'tok' }, { type: 'QUICK_REPLY' }],
      limitedTimeOffer: { expirationTime: '2026-12-31T23:59:00Z' },
    })
    expect(configuredTemplateData({ whatsapp_header_type: 'IMAGE', whatsapp_header_url: '{{1}}' })).toEqual({ header: { type: 'IMAGE', mediaUrl: '{{1}}' } })
    expect(build({}, {}, [])).toEqual({})
    expect(findTemplate(null, 't', 'pt_BR')).toBeNull()
  })

  it('sends templateData verbatim next to the body placeholders', () => {
    const template = { ...parseTemplate({ whatsapp_template: { name: 'confronto_perfeito_elton' } })!, data: { buttons: [{ type: 'QUICK_REPLY', parameter: 'Bloquear Contato' }] } }
    expect(JSON.parse(String(infobipRequest({ ...send, template }).init.body)).messages[0].content).toEqual({
      templateName: 'confronto_perfeito_elton', language: 'pt_BR',
      templateData: { body: { placeholders: [] }, buttons: [{ type: 'QUICK_REPLY', parameter: 'Bloquear Contato' }] },
    })
    expect(dispatcher).toContain('buildTemplateData(approved, configuredTemplateData(found.data), template.placeholders ?? [])')
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
