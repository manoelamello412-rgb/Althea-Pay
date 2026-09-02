import { describe, expect, it } from 'vitest'
import { canTransitionFinancialState, normalizeFinancialState } from '../supabase/functions/_shared/financial-state'

describe('Financial state machine', () => {
  it('normalizes provider aliases to canonical states', () => {
    expect(normalizeFinancialState('paid')).toBe('approved')
    expect(normalizeFinancialState('declined')).toBe('failed')
    expect(normalizeFinancialState('refund')).toBe('refunded')
    expect(normalizeFinancialState('charge_back')).toBe('chargeback')
  })

  it('allows the normal payment lifecycle', () => {
    expect(canTransitionFinancialState('pending', 'approved')).toBe(true)
    expect(canTransitionFinancialState('approved', 'refunded')).toBe(true)
    expect(canTransitionFinancialState('approved', 'chargeback')).toBe(true)
  })

  it('rejects terminal-state regressions', () => {
    expect(canTransitionFinancialState('approved', 'pending')).toBe(false)
    expect(canTransitionFinancialState('refunded', 'approved')).toBe(false)
    expect(canTransitionFinancialState('chargeback', 'approved')).toBe(false)
    expect(canTransitionFinancialState('failed', 'approved')).toBe(false)
  })

  it('accepts a first transition when the current state is unknown', () => {
    expect(canTransitionFinancialState(null, 'pending')).toBe(true)
  })
})
