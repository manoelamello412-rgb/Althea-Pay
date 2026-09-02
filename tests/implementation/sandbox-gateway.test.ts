import { describe, expect, it } from 'vitest'

type SandboxOutcome = 'approved' | 'declined' | 'technical_failure'

function simulate(outcome: SandboxOutcome) {
  if (outcome === 'approved') return { approved: true, retryable: false }
  if (outcome === 'declined') return { approved: false, retryable: false }
  return { approved: false, retryable: true }
}

describe('sandbox gateway contract', () => {
  it('approves the deterministic success scenario', () => {
    expect(simulate('approved')).toEqual({ approved: true, retryable: false })
  })

  it('does not fallback a definitive customer decline', () => {
    expect(simulate('declined').retryable).toBe(false)
  })

  it('marks technical failures as retryable/fallback eligible', () => {
    expect(simulate('technical_failure').retryable).toBe(true)
  })
})
