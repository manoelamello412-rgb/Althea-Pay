import { describe, expect, test, vi } from 'vitest'
import { InMemoryCircuitStore, SmartRouter, type GatewayExecutionResult } from '../../lib/routing/SmartRouter'

const payload = {
  transactionId: 'd6b4563-71ab-4001-9011-209bf6d91244',
  tenantId: 'tenant-test-88123',
  amount: 1500,
  currency: 'BRL',
  paymentToken: 'network-token-test',
}

const waitFree = vi.fn(async () => undefined)

describe('Smart Routing & Circuit Breaker', () => {
  test('faz retry com a mesma idempotency key e depois faz fallback para o secundário', async () => {
    const calls: Array<{ provider: string; key: string }> = []
    const stripe = vi.fn(async (_p, _attempt, key): Promise<GatewayExecutionResult> => {
      calls.push({ provider: 'stripe', key })
      return { httpStatus: 502, failureClass: 'unavailable', error: 'provider_5xx' }
    })
    const adyen = vi.fn(async (_p, _attempt, key): Promise<GatewayExecutionResult> => {
      calls.push({ provider: 'adyen', key })
      return { id: 'adyen_tx_92813123', status: 'approved' }
    })

    const router = new SmartRouter(
      ['STRIPE', 'ADYEN'],
      { STRIPE: stripe, ADYEN: adyen },
      new InMemoryCircuitStore(3, 30_000),
      { maxRetriesPerProvider: 1, sleep: waitFree },
    )

    const result = await router.routeAndExecute(payload)

    expect(result.status).toBe('FALLBACK_TRIGGERED')
    expect(result.providerUsed).toBe('adyen')
    expect(result.gatewayTransactionId).toBe('adyen_tx_92813123')
    expect(result.attemptsCount).toBe(3)
    expect(stripe).toHaveBeenCalledTimes(2)
    expect(adyen).toHaveBeenCalledTimes(1)
    expect(calls[0]?.key).toBe(calls[1]?.key)
    expect(waitFree).toHaveBeenCalledTimes(1)
  })

  test('não faz fallback em erro de negócio', async () => {
    const adyen = vi.fn(async (): Promise<GatewayExecutionResult> => ({ httpStatus: 402, failureClass: 'declined', error: 'card_declined' }))
    const pagarme = vi.fn(async (): Promise<GatewayExecutionResult> => ({ id: 'should_not_run', status: 'approved' }))

    const router = new SmartRouter(
      ['ADYEN', 'PAGARME'],
      { ADYEN: adyen, PAGARME: pagarme },
      new InMemoryCircuitStore(),
      { maxRetriesPerProvider: 2, sleep: waitFree },
    )

    const result = await router.routeAndExecute(payload)

    expect(result.status).toBe('CRITICAL_FAILURE')
    expect(result.providerUsed).toBe('adyen')
    expect(adyen).toHaveBeenCalledTimes(1)
    expect(pagarme).not.toHaveBeenCalled()
  })

  test('isola o circuito por tenant e por provedor', async () => {
    const store = new InMemoryCircuitStore(3, 30_000)
    const failing = vi.fn(async (): Promise<GatewayExecutionResult> => ({ httpStatus: 503, failureClass: 'unavailable', error: 'unavailable' }))
    const healthy = vi.fn(async (): Promise<GatewayExecutionResult> => ({ id: 'healthy_tx', status: 'approved' }))
    const executors = { STRIPE: failing, ADYEN: healthy }

    const routerA = new SmartRouter(['STRIPE'], executors, store, { maxRetriesPerProvider: 0 })
    const routerB = new SmartRouter(['STRIPE'], executors, store, { maxRetriesPerProvider: 0 })

    for (let i = 0; i < 3; i += 1) await routerA.routeAndExecute({ ...payload, tenantId: 'tenant-A' })
    const blockedA = await routerA.routeAndExecute({ ...payload, tenantId: 'tenant-A' })
    const openB = await routerB.routeAndExecute({ ...payload, tenantId: 'tenant-B' })

    expect(blockedA.status).toBe('CIRCUIT_OPEN')
    expect(openB.status).toBe('CIRCUIT_OPEN')
    expect(failing).toHaveBeenCalledTimes(4)
  })
})
