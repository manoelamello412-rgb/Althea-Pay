// Lightweight idempotency store used by application-layer tests and adapters.
// Production Edge Functions use the database-backed idempotency_keys table directly.
export class IdempotencyStore {
  private memory = new Map<string, unknown>()

  async get(key: string) {
    if (!key) return null
    return this.memory.get(key) ?? null
  }

  async set(key: string, value: unknown) {
    if (!key) return
    this.memory.set(key, value)
  }
}
