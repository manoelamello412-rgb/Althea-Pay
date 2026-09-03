import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const path = 'supabase/functions/checkout-engine-v2/index.ts'

describe('checkout idempotency contract', () => {
  it('scopes checkout-session idempotency by lifecycle action', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('const checkoutIdempotencyKey = action === "purchase" ? idempotencyKey : `start:${idempotencyKey}`')
    expect(source).toContain('idempotency_key: checkoutIdempotencyKey')
  })

  it('keeps payment idempotency independent and stable for the gateway', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('"x-idempotency-key": idempotencyKey')
    expect(source).toContain('idempotency_key: idempotencyKey')
  })

  it('replays only the same checkout lifecycle operation', async () => {
    const source = await readFile(path, 'utf8')
    expect(source).toContain('.eq("idempotency_key", checkoutIdempotencyKey)')
  })
})
