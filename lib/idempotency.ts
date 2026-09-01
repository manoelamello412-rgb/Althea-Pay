// Simple Idempotency helper with DB-backed or in-memory fallback
import { Client } from 'pg'

export class IdempotencyStore {
  dbUrl: string | undefined
  memory: Map<string, any>
  constructor() {
    this.dbUrl = process.env.DATABASE_URL
    this.memory = new Map()
  }

  async get(key: string) {
    if (!key) return null
    if (this.dbUrl) {
      try {
        const client = new Client({ connectionString: this.dbUrl })
        await client.connect()
        const r = await client.query('SELECT response FROM idempotency_keys WHERE idempotency_key = $1 LIMIT 1', [key])
        await client.end()
        if (r.rows[0]) return r.rows[0].response
        return null
      } catch (err) {
        // fallback to memory if DB unavailable
      }
    }
    return this.memory.get(key) || null
  }

  async set(key: string, value: any) {
    if (!key) return
    if (this.dbUrl) {
      try {
        const client = new Client({ connectionString: this.dbUrl })
        await client.connect()
        await client.query('INSERT INTO idempotency_keys (idempotency_key, response) VALUES ($1, $2) ON CONFLICT (idempotency_key) DO UPDATE SET response = EXCLUDED.response', [key, value])
        await client.end()
        return
      } catch (err) {
        // fallback
      }
    }
    this.memory.set(key, value)
  }
}
