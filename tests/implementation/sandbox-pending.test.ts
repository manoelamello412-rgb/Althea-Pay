import { describe, expect, it } from 'vitest'
import { simulateSandboxPayment } from '../../supabase/functions/_shared/gateway-sandbox-sim'

describe('Sandbox pending contract', () => {
  it('models a provider-confirmation pending payment deterministically', () => {
    const first = simulateSandboxPayment({ amount: 100, currency: 'BRL', idempotency_key: 'pending-1' }, { forceScenario: 'pending' })
    const second = simulateSandboxPayment({ amount: 100, currency: 'BRL', idempotency_key: 'pending-1' }, { forceScenario: 'pending' })

    expect(first.status).toBe('pending')
    expect(first.retryable).toBe(false)
    expect(first.reason).toBe('awaiting_provider_confirmation')
    expect(first.id).toBe(second.id)
  })
})
