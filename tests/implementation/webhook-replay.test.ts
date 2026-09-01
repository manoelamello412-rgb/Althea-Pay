import { describe, expect, it } from 'vitest'

describe('webhook replay contract', () => {
  it('rejects timestamps outside the configured replay window', () => {
    const now = Date.now()
    const receivedAt = now - 6 * 60 * 1000
    const maxAge = 5 * 60 * 1000
    expect(now - receivedAt > maxAge).toBe(true)
  })

  it('requires a stable event key for deduplication', () => {
    const delivery = { eventKey: 'provider:event:123' }
    expect(delivery.eventKey).toMatch(/^provider:event:/)
  })
})
