import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync('app/api/payments/create/route.ts', 'utf8')
const guard = readFileSync('supabase/migrations/20261014190000_gateway_ambiguous_guard_same_gateway_retry_v1.sql', 'utf8')
const adapter = readFileSync('supabase/functions/gateway-provider-adapter/index.ts', 'utf8')

describe('Pix retry after the adapter never produced a charge', () => {
  it('calls the adapter again for a pending transaction without external id, on the same gateway', () => {
    expect(route).toContain("text(transaction.status) === 'pending' && !text(transaction.external_id) && text(transaction.gateway_id) === selectedGatewayId")
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
})
