import { describe, expect, it } from 'vitest'
import { resolveRoute } from './routing'
import type { PaymentFlow } from './types'

const flow: PaymentFlow = {
  id: 'flow-1',
  funnelId: 'funnel-1',
  versionId: 'version-1',
  version: 1,
  status: 'published',
  steps: [
    {
      id: 'step-1',
      gatewayConnectionId: 'gateway-high-value',
      stepOrder: 1,
      method: 'credit_card',
      action: 'route',
      conditions: { minAmount: 500 },
      retryableStatuses: ['timeout', 'temporary_error'],
      maxAttempts: 1,
      enabled: true,
    },
    {
      id: 'step-2',
      gatewayConnectionId: 'gateway-default',
      stepOrder: 2,
      method: 'credit_card',
      action: 'fallback',
      conditions: {},
      retryableStatuses: ['timeout', 'temporary_error'],
      maxAttempts: 1,
      enabled: true,
    },
  ],
}

describe('Payment OS routing', () => {
  it('selects a deterministic conditional route', () => {
    const decision = resolveRoute(flow, {
      amount: 900,
      currency: 'BRL',
      method: 'credit_card',
    })

    expect(decision.step.gatewayConnectionId).toBe('gateway-high-value')
    expect(decision.reason).toBe('condition_match')
  })

  it('falls back to the default route when no condition matches', () => {
    const decision = resolveRoute(flow, {
      amount: 100,
      currency: 'BRL',
      method: 'credit_card',
    })

    expect(decision.step.gatewayConnectionId).toBe('gateway-default')
    expect(decision.reason).toBe('fallback')
  })
})
