import { describe, expect, it } from 'vitest'

function nextAttempt(attempts: number, maxAttempts: number) {
  return attempts >= maxAttempts ? 'dead' : 'pending'
}

describe('core queue retry policy', () => {
  it('retries before reaching the limit', () => {
    expect(nextAttempt(1, 8)).toBe('pending')
    expect(nextAttempt(7, 8)).toBe('pending')
  })

  it('moves to the DLQ at max attempts', () => {
    expect(nextAttempt(8, 8)).toBe('dead')
    expect(nextAttempt(20, 8)).toBe('dead')
  })
})
