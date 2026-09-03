import { describe, expect, it } from 'vitest'
import { canTransitionFinancialState, normalizeFinancialState } from '../supabase/functions/_shared/financial-state'

describe('financial state machine', () => {
  it('normalizes provider aliases', () => {
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

  it('rejects terminal-state regression', () => {
    expect(canTransitionFinancialState('approved', 'pending')).toBe(false)
    expect(canTransitionFinancialState('refunded', 'approved')).toBe(false)
    expect(canTransitionFinancialState('chargeback', 'refunded')).toBe(false)
  })

  it('rejects unknown next states', () => {
    expect(canTransitionFinancialState('pending', 'something-else')).toBe(false)
  })
})
