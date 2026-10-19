import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bridgeSendRequest, parseBridgeInbound, whatsappNumber } from '../supabase/functions/_shared/whatsapp'

const migration = readFileSync('supabase/migrations/20261014170000_whatsapp_baileys_payment_pending_v1.sql', 'utf8')
const dispatcher = readFileSync('supabase/functions/crm-channel-outbox-dispatcher/index.ts', 'utf8')
const worker = readFileSync('supabase/functions/checkout-recovery-worker/index.ts', 'utf8')
const webhook = readFileSync('supabase/functions/crm-channel-whatsapp-webhook/index.ts', 'utf8')
const bridge = readFileSync('whatsapp-bridge/server.mjs', 'utf8')

const account = '5a5fee1a-aaba-4228-b2cb-b5d0229e649b'

describe('Baileys bridge adapter', () => {
  it('adds Brazil country code to bare checkout phones', () => {
    expect(whatsappNumber('(11) 98765-4567')).toBe('5511987654567')
    expect(whatsappNumber('+55 11 98765-4567')).toBe('5511987654567')
    expect(whatsappNumber('123')).toBe('')
  })

  it('posts text to the account session with the bridge token', () => {
    const { url, init } = bridgeSendRequest({ baseUrl: 'https://wa.example.com/', token: 't', accountId: account, to: '11987654567', body: 'Oi' })
    expect(url).toBe(`https://wa.example.com/instances/${account}/send`)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t')
    expect(JSON.parse(String(init.body))).toEqual({ to: '5511987654567', text: 'Oi' })
  })

  it('refuses plain-http bridges outside localhost and empty destinations', () => {
    const base = { token: 't', accountId: account, to: '11987654567', body: 'Oi' }
    expect(() => bridgeSendRequest({ ...base, baseUrl: 'http://wa.example.com' })).toThrow('whatsapp_bridge_url_invalid')
    expect(() => bridgeSendRequest({ ...base, baseUrl: 'http://localhost:8080' })).not.toThrow()
    expect(() => bridgeSendRequest({ ...base, baseUrl: 'https://x', to: '' })).toThrow('whatsapp_destination_missing')
  })

  it('parses inbound messages and rejects incomplete ones', () => {
    expect(parseBridgeInbound({ account_id: account, from: '5511987654567', message_id: 'm1', text: ' SAIR ', name: 'Ana', type: 'conversation' }))
      .toEqual({ accountId: account, from: '5511987654567', messageId: 'm1', text: 'SAIR', name: 'Ana', type: 'conversation' })
    expect(parseBridgeInbound({ account_id: '../x', from: '55', message_id: 'm', text: 'a' })).toBeNull()
    expect(parseBridgeInbound(null)).toBeNull()
  })

  it('wires dispatcher, webhook and bridge with the shared token', () => {
    expect(dispatcher).toContain('provider === "baileys" && account.channel === "whatsapp"')
    expect(dispatcher.indexOf('crm_channel_recipient_opted_out')).toBeLessThan(dispatcher.indexOf('const delivery = await deliver('))
    expect(webhook.indexOf('safeEqual(req.headers.get("x-bridge-token")')).toBeLessThan(webhook.indexOf('crm_ingest_channel_message'))
    expect(bridge).toContain('timingSafeEqual')
    expect(bridge).toContain("!ID.test(id ?? '')") // id is a directory name: UUID only
  })
})

describe('payment pending nudge', () => {
  it('enqueues once per checkout, 5 minutes after a still-pending payment', () => {
    expect(migration).toContain("t.status = 'pending'")
    expect(migration).toContain("t.created_at <= now() - interval '5 minutes'")
    expect(migration).toContain("a.status = 'approved'")
    expect(migration).toContain('on conflict (checkout_id, event_type) do nothing')
    expect(migration).toContain("cron.schedule('althea-payment-pending-enqueue', '* * * * *'")
  })

  it('does not consume the abandoned-cart recovery state of the checkout', () => {
    expect(migration.match(/v_event\.event_type<>'payment_pending'/g)).toHaveLength(3)
    expect(migration).toContain("where cl.event_type <> 'payment_pending'")
  })

  it('sends WhatsApp only for pending payments; abandoned carts stay on e-mail/SMS', () => {
    expect(worker).toContain('? ["whatsapp"]')
    expect(worker).toContain(': (["email", "sms"] as const).filter(')
    expect(worker).toContain('`payment-pending:${job.checkout_id}:${selection.channel}`')
  })

  it('keeps server-only RPCs away from clients', () => {
    expect(migration).toContain('revoke all on function public.enqueue_payment_pending_events(integer) from public, anon, authenticated;')
    expect(migration).toContain('revoke all on function public.claim_checkout_recovery_events_v1(integer) from public, anon, authenticated;')
    expect(migration).toContain("private.crm_config_context('can_manage_integrations')")
  })
})

describe('provider choice on one WhatsApp account', () => {
  it('keeps a single WhatsApp account per organization so support threads survive a provider switch', () => {
    expect(migration).toContain("on public.crm_channel_accounts (organization_id) where channel = 'whatsapp'")
    expect(migration).toContain("if p_provider not in ('baileys', 'infobip')")
    expect(migration).not.toMatch(/update public\.crm_channel_accounts set status = 'inactive'/)
  })

  it('stores the Infobip API key in Vault, restricted to its API hosts, readable only by service_role', () => {
    expect(migration).toContain("vault.create_secret(v_secret::text, 'crm_whatsapp_infobip:' || a.id")
    expect(migration).toContain("'^[a-z0-9-]+\\.api\\.infobip\\.com$'")
    expect(migration).toContain('revoke all on function public.crm_channel_account_credentials(uuid) from public, anon, authenticated;')
    expect(migration).toContain('grant execute on function public.crm_channel_account_credentials(uuid) to service_role;')
  })

  it('dispatcher routes each provider and reads panel credentials from Vault', () => {
    expect(dispatcher).toContain('provider === "infobip" && account.channel === "whatsapp") return sendInfobip(')
    expect(dispatcher).toContain('db.rpc("crm_channel_account_credentials"')
  })
})
