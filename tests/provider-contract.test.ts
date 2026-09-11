import { describe, expect, it } from 'vitest'
import {
  isRetryableGatewayFailure,
  normalizeGatewayResponse,
} from '../lib/gateway-adapter'

describe('Gateway provider contract', () => {
  it('normalizes declined and pending failures without enabling failover for business states', () => {
    expect(normalizeGatewayResponse({
      success: false,
      providerTransactionId: 'gw_declined_1',
      status: 'declined',
      amountMinor: 100,
      currency: 'BRL',
    }).failureClass).toBe('declined')

    expect(normalizeGatewayResponse({
      success: true,
      providerTransactionId: 'gw_pending_1',
      status: 'pending',
      amountMinor: 100,
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
      success: true,
      providerTransactionId: '',
      status: 'approved',
      amountMinor: 100,
      currency: 'BRL',
    })).toThrow('gateway_response_missing_provider_transaction_id')

    expect(() => normalizeGatewayResponse({
      success: true,
      providerTransactionId: 'bad_amount',
      status: 'approved',
      amountMinor: -1,
      currency: 'BRL',
    })).toThrow('gateway_response_invalid_amount')

    expect(() => normalizeGatewayResponse({
      success: true,
      providerTransactionId: 'bad_currency',
      status: 'approved',
      amountMinor: 100,
      currency: 'brl',
    })).toThrow('gateway_response_invalid_currency')
  })
})
