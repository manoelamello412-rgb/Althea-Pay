import { describe, expect, it } from 'vitest'
import { simulateSandboxPayment } from '../supabase/functions/_shared/gateway-sandbox-sim'

describe('Gateway Sandbox', () => {
  it.each([
    ['approved', false],
    ['declined', false],
    ['error', true],
    ['refund', false],
    ['chargeback', false],
  ] as const)('simulates %s with retryable=%s', (scenario, retryable) => {
    const result = simulateSandboxPayment({ amount: 1000, currency: 'brl', idempotency_key: `sandbox-${scenario}-1` }, { forceScenario: scenario })
    expect(result.status).toBe(scenario)
    expect(result.amount).toBe(1000)
    expect(result.currency).toBe('BRL')
    expect(result.gateway).toBe('sandbox')
    expect(result.retryable).toBe(retryable)
  })

  it('returns stable transaction ids for the same idempotency key', () => {
    const first = simulateSandboxPayment({ amount: 1000, currency: 'BRL', idempotency_key: 'sandbox-duplicate-1' })
    const second = simulateSandboxPayment({ amount: 1000, currency: 'BRL', idempotency_key: 'sandbox-duplicate-1' })
    expect(second.id).toBe(first.id)
  })

  it('does not expose card credentials in the result', () => {
    const result = simulateSandboxPayment({ amount: 1000, card_number: '4111111111111111', cvv: '123' })
    expect(JSON.stringify(result)).not.toContain('4111111111111111')
    expect(JSON.stringify(result)).not.toContain('123')
  })
})
