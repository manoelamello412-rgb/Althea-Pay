import { IdempotencyStore } from '../lib/idempotency'

describe('IdempotencyStore', () => {
  it('stores and retrieves from memory when DATABASE_URL not set', async () => {
    const s = new IdempotencyStore()
    const key = 'test-key-1'
    await s.set(key, { ok: true })
    const v = await s.get(key)
    expect(v).toEqual({ ok: true })
  })
})
