import { describe, expect, it } from 'vitest'
import { simulateGatewaySandbox } from '../_shared/gateway-sandbox-sim'

describe('Gateway Sandbox', () => {
  it('approves a payment deterministically', async () => {
    const result = await simulateGatewaySandbox({
      amount: 1000,
      currency: 'BRL',
      scenario: 'approved',
      idempotencyKey: 'sandbox-approved-1',
    })

    expect(result.status).toBe('approved')
    expect(result.transaction_id).toContain('sandbox_tx_')
  })

  it('returns stable transaction ids for the same idempotency key', async () => {
    const first = await simulateGatewaySandbox({
      amount: 1000,
      currency: 'BRL',
      scenario: 'approved',
      idempotencyKey: 'sandbox-duplicate-1',
    })
    const second = await simulateGatewaySandbox({
      amount: 1000,
      currency: 'BRL',
      scenario: 'approved',
      idempotencyKey: 'sandbox-duplicate-1',
    })

    expect(second.transaction_id).toBe(first.transaction_id)
    expect(second.status).toBe('approved')
  })

  it.each([
    ['declined', 'declined'],
    ['error', 'error'],
    ['refund', 'refunded'],
    ['chargeback', 'chargeback'],
  ] as const)('simulates %s', async (scenario, expectedStatus) => {
    const result = await simulateGatewaySandbox({
      amount: 1000,
      currency: 'BRL',
      scenario,
      idempotencyKey: `sandbox-${scenario}-1`,
    })

    expect(result.status).toBe(expectedStatus)
  })
})
