import { describe, expect, it } from 'vitest'
import {
  isRetryableGatewayFailure,
  normalizeGatewayResponse,
} from '../lib/gateway-adapter'

describe('Gateway provider contract', () => {
  it('normalizes declined and pending failures without enabling failover for business states', () => {
    expect(normalizeGatewayResponse({
      id: 'gw_declined_1',
      status: 'declined',
      amount: 100,
      currency: 'BRL',
    }).failureClass).toBe('declined')

    expect(normalizeGatewayResponse({
      id: 'gw_pending_1',
      status: 'pending',
      amount: 100,
      currency: 'BRL',
    }).failureClass).toBe('pending')

    expect(isRetryableGatewayFailure('declined')).toBe(false)
    expect(isRetryableGatewayFailure('fraud')).toBe(false)
    expect(isRetryableGatewayFailure('pending')).toBe(false)
  })

  it('only marks technical transport failures as retryable', () => {
    expect(isRetryableGatewayFailure('technical')).toBe(true)
    expect(isRetryableGatewayFailure('timeout')).toBe(true)
    expect(isRetryableGatewayFailure('unavailable')).toBe(true)
    expect(isRetryableGatewayFailure('validation')).toBe(false)
    expect(isRetryableGatewayFailure('unknown')).toBe(false)
  })

  it('rejects malformed provider responses before they reach the financial core', () => {
    expect(() => normalizeGatewayResponse({
      id: '',
      status: 'approved',
      amount: 100,
      currency: 'BRL',
    })).toThrow('gateway_response_missing_id')

    expect(() => normalizeGatewayResponse({
      id: 'bad_amount',
      status: 'approved',
      amount: -1,
      currency: 'BRL',
    })).toThrow('gateway_response_invalid_amount')

    expect(() => normalizeGatewayResponse({
      id: 'bad_currency',
      status: 'approved',
      amount: 100,
      currency: 'brl',
    })).toThrow('gateway_response_invalid_currency')
  })
})
