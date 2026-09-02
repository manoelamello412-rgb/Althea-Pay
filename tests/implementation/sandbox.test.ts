import { describe, expect, it } from 'vitest'
import { simulateSandboxPayment } from '../../supabase/functions/_shared/gateway-sandbox-sim'

describe('sandbox gateway contract', () => {
  it.each([
    ['approved', 'approved', false],
    ['declined', 'declined', false],
    ['error', 'error', true],
    ['refund', 'refund', false],
    ['chargeback', 'chargeback', false],
  ] as const)('simulates %s deterministically', (scenario, status, retryable) => {
    const a = simulateSandboxPayment({ amount: 100, currency: 'brl', idempotency_key: `test-${scenario}` }, { forceScenario: scenario })
    const b = simulateSandboxPayment({ amount: 100, currency: 'brl', idempotency_key: `test-${scenario}` }, { forceScenario: scenario })
    expect(a.status).toBe(status)
    expect(a.retryable).toBe(retryable)
    expect(a.id).toBe(b.id)
    expect(a.amount).toBe(100)
    expect(a.currency).toBe('BRL')
    expect(a.gateway).toBe('sandbox')
  })

  it('never requires PAN or CVC', () => {
    const result = simulateSandboxPayment({ amount: 50, currency: 'BRL', idempotency_key: 'no-card-data' })
    expect(JSON.stringify(result)).not.toMatch(/pan|cvc|cvv|card_number/i)
  })
})
