import { describe, expect, it } from 'vitest'
import { IdempotencyStore } from '../lib/idempotency'

describe('IdempotencyStore', () => {
  it('stores and retrieves values in the application fallback', async () => {
    const store = new IdempotencyStore()
    await store.set('test-key-1', { ok: true })
    await expect(store.get('test-key-1')).resolves.toEqual({ ok: true })
  })

  it('returns null for an empty key', async () => {
    const store = new IdempotencyStore()
    await expect(store.get('')).resolves.toBeNull()
  })
})
