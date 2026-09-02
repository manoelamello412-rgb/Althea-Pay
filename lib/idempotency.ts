import { query } from './db'

const memory = new Map<string, unknown>()
const HEADERS_IDEMPOTENCY = ['idempotency-key', 'Idempotency-Key', 'idempotency_key']

export class IdempotencyStore {
  private store = new Map<string, unknown>()
  async get(key: string): Promise<unknown | null> {
    return key ? (this.store.get(key) ?? null) : null
  }
  async set(key: string, value: unknown): Promise<void> {
    if (key) this.store.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
  async clear(): Promise<void> {
    this.store.clear()
  }
}

export async function getIdempotency(key: string): Promise<unknown | null> {
  return key ? (memory.get(key) ?? null) : null
}

export async function saveIdempotency(key: string, response: unknown): Promise<void> {
  if (key) memory.set(key, response)
}

export async function getIdempotencyFromRequest(req: any): Promise<string | null> {
  const headers = req?.headers
  if (!headers) return null
  for (const name of HEADERS_IDEMPOTENCY) {
    const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export async function dbGetIdempotency(key: string, scope = 'legacy'): Promise<unknown | null> {
  if (!key) return null
  try {
    const result = await query(
      `SELECT response_payload FROM idempotency_keys WHERE idempotency_key = $1 AND scope = $2 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`,
      [key, scope],
    )
    return result.rows[0]?.response_payload ?? null
  } catch {
    return null
  }
}

export async function dbSaveIdempotency(key: string, response: unknown, scope = 'legacy'): Promise<void> {
  if (!key) return
  try {
    await query(
      `INSERT INTO idempotency_keys (user_id, scope, idempotency_key, status, response_payload, expires_at)
       VALUES ($1, $2, $3, 'completed', $4::jsonb, now() + interval '24 hours')
       ON CONFLICT (user_id, scope, idempotency_key) DO UPDATE
       SET status = EXCLUDED.status, response_payload = EXCLUDED.response_payload, updated_at = now()`,
      ['00000000-0000-0000-0000-000000000000', scope, key, JSON.stringify(response)],
    )
  } catch {
    // DATABASE_URL is optional for local/UI tests; memory remains the safe fallback.
  }
}

export async function useIdempotencyFromReq(req: any, handler: () => Promise<any>) {
  const key = await getIdempotencyFromRequest(req)
  if (!key) return handler()
  const mem = await getIdempotency(key)
  if (mem !== null) return mem
  const db = await dbGetIdempotency(key)
  if (db !== null) {
    await saveIdempotency(key, db)
    return db
  }
  const result = await handler()
  await saveIdempotency(key, result)
  return result
}
