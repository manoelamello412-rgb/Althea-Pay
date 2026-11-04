import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync('app/api/payments/create/route.ts', 'utf8')
const guard = readFileSync('supabase/migrations/20261014190000_gateway_ambiguous_guard_same_gateway_retry_v1.sql', 'utf8')
const adapter = readFileSync('supabase/functions/gateway-provider-adapter/index.ts', 'utf8')
const pixGuard = readFileSync('supabase/migrations/20261104210000_sigilopay_provider_v1.sql', 'utf8')
const webhook = readFileSync('supabase/functions/gateway-webhook/index.ts', 'utf8')
const action = readFileSync('app/api/payments/action/route.ts', 'utf8')

describe('Pix retry after the adapter never produced a charge', () => {
  it('calls the adapter again for a pending transaction without external id', () => {
    expect(route).toContain("const retryingAdapter = text(transaction.status) === 'pending' && !text(transaction.external_id)")
  })

  it('fails over to backup gateways only for Pix, and only when the gateway did not produce the charge', () => {
    expect(route).toContain("(paymentMethod === 'pix' || r.primary)")
    expect(route).toContain("if (!produced && hasFallback)")
    expect(route).toContain(".order('is_primary', { ascending: false })")
  })

  it('lets Pix skip the ambiguous-failover guard but keeps it for other methods', () => {
    expect(pixGuard).toContain("lower(coalesce(t.metadata->>'payment_method','')) = 'pix'")
    expect(pixGuard).toContain("RAISE EXCEPTION 'ambiguous_gateway_attempt_requires_status_recovery'")
  })

  it('groups attempts per payment, not under a shared "attempt:" prefix', () => {
    expect(route).toContain('const attemptKey = `${idempotencyKey}:${selectedGatewayId}`')
    expect(route).not.toContain('`attempt:${idempotencyKey}`')
  })

  it('still blocks failover to another gateway while an attempt is ambiguous', () => {
    expect(guard).toContain('a.gateway_id IS DISTINCT FROM NEW.gateway_id')
    expect(guard).toContain("RAISE EXCEPTION 'ambiguous_gateway_attempt_requires_status_recovery'")
  })

  it('keeps https QR image URLs instead of prefixing them as base64', () => {
    expect(adapter).toContain('/^https:\\/\\//i.test(img)?img:')
  })

  it('SigiloPay: fixed callbackUrl with query token, event-driven status and throttled status lookups', () => {
    expect(adapter).toContain('callbackUrl:`${su.replace(/\\/$/,"")}/functions/v1/gateway-webhook?gateway_id=')
    expect(adapter).toContain('call("/gateway/producer/credentials")')
    expect(adapter).toContain('metadata:{provider:"AltheaPay",orderId:identifier}')
    expect(adapter).toContain('/gateway/transactions?clientIdentifier=')
    expect(adapter).toContain('QRCode.toDataURL(code')
    expect(webhook).toContain('CHARGEBACK_CREATED: ["chargeback", "chargeback"]')
    expect(webhook).toContain('tx.identifier')
    expect(webhook).toContain('TRANSACTION_PAID: ["approved", "payment"]')
    expect(webhook).toContain('TRANSACTION_REFUNDED: ["refunded", "refund"]')
    expect(webhook).toContain('TRANSACTION_CHARGED_BACK: ["chargeback", "chargeback"]')
    expect(action).toContain("p_bucket_key: `provider-status:sigilopay:${tx.id}`, p_limit: 1, p_window_seconds: 60")
  })
})
