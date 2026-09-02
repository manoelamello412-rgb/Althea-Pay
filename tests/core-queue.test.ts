import { describe, expect, it } from 'vitest'

function nextAttempt(attempts: number, maxAttempts: number) {
  if (attempts >= maxAttempts) return 'dead'
  return 'pending'
}

describe('core queue policy', () => {
  it('retries before reaching the limit', () => {
    expect(nextAttempt(1, 8)).toBe('pending')
    expect(nextAttempt(7, 8)).toBe('pending')
  })

  it('moves to DLQ at max attempts', () => {
    expect(nextAttempt(8, 8)).toBe('dead')
  })

  it('never retries an already terminal attempt count', () => {
    expect(nextAttempt(20, 8)).toBe('dead')
  })
})
