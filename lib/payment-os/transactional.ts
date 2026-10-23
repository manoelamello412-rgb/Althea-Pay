import { PaymentOsError } from './types'
import { withExponentialBackoff, type RetryPolicy, DEFAULT_RETRY_POLICY } from './retry'

export type IdempotencyLease<TResponse> = {
  acquired: boolean
  response?: TResponse
  release: (status: 'completed' | 'failed', response?: TResponse) => Promise<void>
}

export type IdempotencyStore<TResponse> = {
  acquire(input: { organizationId: string; key: string; requestHash: string }): Promise<IdempotencyLease<TResponse>>
}

export async function executeIdempotentMutation<TResponse>(input: {
  store: IdempotencyStore<TResponse>
  organizationId: string
  idempotencyKey: string
  requestHash: string
  operation: () => Promise<TResponse>
  retryPolicy?: RetryPolicy
}): Promise<TResponse> {
  const lease = await input.store.acquire({
    organizationId: input.organizationId,
    key: input.idempotencyKey,
    requestHash: input.requestHash,
  })

  if (!lease.acquired) {
    if (lease.response !== undefined) return lease.response
    throw new PaymentOsError('IDEMPOTENCY_IN_PROGRESS', 'An identical payment mutation is already being processed.', {
      retryable: true,
    })
  }

  let status: 'completed' | 'failed' = 'failed'
  let response: TResponse | undefined

  try {
    response = await withExponentialBackoff(input.operation, input.retryPolicy ?? DEFAULT_RETRY_POLICY)
    status = 'completed'
    return response
  } catch (error) {
    throw error
  } finally {
    // A lease is always released, including provider errors, unique conflicts and unexpected exceptions.
    await lease.release(status, response)
  }
}
