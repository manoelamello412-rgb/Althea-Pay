import { describe, expect, it } from 'vitest'
import { simulateSandboxPayment } from '../../supabase/functions/_shared/gateway-sandbox-sim'

describe('sandbox core contract', () => {
  it('covers success, decline, technical failure, refund and chargeback', () => {
    const scenarios = ['approved', 'declined', 'error', 'refund', 'chargeback'] as const
    for (const scenario of scenarios) {
      const result = simulateSandboxPayment(
        { amount: 100, currency: 'brl', idempotency_key: `core-${scenario}` },
        { forceScenario: scenario },
      )
      expect(result.gateway).toBe('sandbox')
      expect(result.currency).toBe('BRL')
      expect(result.amount).toBe(100)
      expect(result.status).toBe(scenario)
    }
  })

  it('never handles raw card credentials', () => {
    const result = simulateSandboxPayment({ amount: 50, currency: 'BRL', idempotency_key: 'safe-core-test' })
    expect(JSON.stringify(result)).not.toMatch(/pan|cvc|cvv|card_number/i)
  })
})
