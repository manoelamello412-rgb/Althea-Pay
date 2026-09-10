import { describe, expect, it } from 'vitest'

import { hashToolRequest } from './idempotency-store'

const baseCall = {
  toolKey: 'forecast_metric',
  version: 1,
  input: { metric: 'checkout_conversion', horizon: 60 },
}

describe('IaraIdempotencyStore', () => {
  it('produces the same hash when object keys are reordered', () => {
    expect(hashToolRequest(baseCall)).toBe(hashToolRequest({
      ...baseCall,
      input: { horizon: 60, metric: 'checkout_conversion' },
    }))
  })

  it('changes the hash when the tool request changes', () => {
    expect(hashToolRequest(baseCall)).not.toBe(hashToolRequest({
      ...baseCall,
      input: { metric: 'checkout_conversion', horizon: 61 },
    }))
  })

  it('does not include the caller idempotency key in the request hash', () => {
    expect(hashToolRequest({ ...baseCall, idempotencyKey: 'attempt-a' }))
      .toBe(hashToolRequest({ ...baseCall, idempotencyKey: 'attempt-b' }))
  })
})
