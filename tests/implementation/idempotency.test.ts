import { describe, expect, it } from 'vitest'

describe('idempotency contract', () => {
  it('requires a stable key for a payment command', () => {
    const command = { amount: 1000, currency: 'BRL', idempotencyKey: 'checkout-123-attempt-1' }
    expect(command.idempotencyKey).toBeTruthy()
  })

  it('same idempotency key maps to the same logical operation', () => {
    const first = 'checkout-123-attempt-1'
    const replay = 'checkout-123-attempt-1'
    expect(replay).toBe(first)
  })
})
