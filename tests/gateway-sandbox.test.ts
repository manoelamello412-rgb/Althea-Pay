import { describe, expect, it } from 'vitest'
import { simulateSandboxPayment } from '../supabase/functions/_shared/gateway-sandbox-sim'

describe('Gateway Sandbox', () => {
  it('approves a payment deterministically', () => {
    const result = simulateSandboxPayment({
      amount: 1000,
      currency: 'BRL',
      scenario: 'approved',
      idempotency_key: 'sandbox-approved-1',
    })

    expect(result.status).toBe('approved')
    expect(result.id).toContain('sb_tx_')
  })

  it('models pending provider confirmation deterministically', () => {
    const result = simulateSandboxPayment({
      amount: 1000,
      currency: 'BRL',
      scenario: 'pending',
      idempotency_key: 'sandbox-pending-1',
    })

    expect(result.status).toBe('pending')
    expect(result.retryable).toBe(false)
    expect(result.reason).toBe('awaiting_provider_confirmation')
  })

  it('returns stable transaction ids for the same idempotency key', () => {
    const first = simulateSandboxPayment({
      amount: 1000,
      currency: 'BRL',
      scenario: 'approved',
      idempotency_key: 'sandbox-duplicate-1',
    })
    const second = simulateSandboxPayment({
      amount: 1000,
      currency: 'BRL',
      scenario: 'approved',
      idempotency_key: 'sandbox-duplicate-1',
    })

    expect(second.id).toBe(first.id)
    expect(second.status).toBe('approved')
  })

  it.each([
    ['declined', 'declined'],
    ['error', 'error'],
    ['refund', 'refund'],
    ['chargeback', 'chargeback'],
  ] as const)('simulates %s', (scenario, expectedStatus) => {
    const result = simulateSandboxPayment({
      amount: 1000,
      currency: 'BRL',
      scenario,
      idempotency_key: `sandbox-${scenario}-1`,
    })

    expect(result.status).toBe(expectedStatus)
  })
})
