import { PaymentOsError } from './types'

export type RetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  jitterRatio: 0.2,
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown }
  return candidate.code === '23505'
}

export function isRetryablePaymentError(error: unknown): boolean {
  if (error instanceof PaymentOsError) return error.retryable
  if (isPostgresUniqueViolation(error)) return true
  return false
}

function delayMs(attempt: number, policy: RetryPolicy): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  const jitter = exponential * policy.jitterRatio * Math.random()
  return Math.round(exponential + jitter)
}

export async function withExponentialBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (!isRetryablePaymentError(error) || attempt === policy.maxAttempts) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs(attempt, policy)))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operation failed after retry policy was exhausted.')
}
