import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import * as crypto from 'node:crypto'

const databaseUrl = process.env.DATABASE_URL_TEST
const testUserId = process.env.ALTHEA_TEST_USER_ID
const run = databaseUrl && testUserId ? describe : describe.skip

function verifyMetaSignature(payload: string, signature: string, secret: string): boolean {
  try {
    if (!signature.startsWith('sha256=')) return false
    const actualHex = signature.slice('sha256='.length)
    if (!/^[0-9a-f]{64}$/i.test(actualHex)) return false
    const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest()
    const actual = Buffer.from(actualHex, 'hex')
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function classifyProviderHttpError(status: number) {
  const retryable = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
  return { retryable, action: retryable ? 'RETRY' : 'DLQ' as const }
}

function verifySvixSignature(
  payload: string,
  headers: { id: string; timestamp: string; signatures: string },
  secret: string,
): boolean {
  try {
    if (!headers.id || !headers.timestamp || !headers.signatures) return false
    const keyRaw = secret.replace(/^whsec_/, '')
    const key = Buffer.from(keyRaw, 'base64')
    if (key.length === 0) return false
    const expected = crypto
      .createHmac('sha256', key)
      .update(`${headers.id}.${headers.timestamp}.${payload}`, 'utf8')
      .digest()

    return headers.signatures.split(' ').some((part) => {
      if (!part.startsWith('v1,')) return false
      const actual = Buffer.from(part.slice(3), 'base64')
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    })
  } catch {
    return false
  }
}

run('Chat CRM — Omnichannel provider contracts', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 })
  const accountId = crypto.randomUUID()
  const outboxId = crypto.randomUUID()
  const externalMessageId = `provider-contract-${crypto.randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into public.crm_channel_accounts
        (id,user_id,channel,provider,external_account_id,display_name,status,metadata)
       values ($1,$2,'whatsapp','contract_test',$3,'provider contract test','active','{}'::jsonb)`,
      [accountId, testUserId, `contract-${crypto.randomUUID()}`],
    )

    await pool.query(
      `insert into public.crm_channel_message_outbox
        (id,user_id,conversation_id,channel_account_id,channel,external_message_id,
         idempotency_key,direction,body,status,attempts,max_attempts,metadata)
       values ($1,$2,null,$3,'whatsapp',$4,$5,'outbound','provider contract test',
               'sent',0,3,'{}'::jsonb)`,
      [outboxId, testUserId, accountId, externalMessageId, `contract:${outboxId}`],
    )
  })

  afterAll(async () => {
    await pool.query('delete from public.crm_channel_delivery_events where channel_account_id=$1', [accountId])
    await pool.query('delete from public.crm_channel_message_outbox where id=$1', [outboxId])
    await pool.query('delete from public.crm_channel_accounts where id=$1', [accountId])
    await pool.end()
  })

  describe('Meta / WhatsApp / Instagram', () => {
    it('accepts canonical HMAC-SHA256 and rejects malformed or asymmetric signatures without throwing', () => {
      const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
      const secret = 'meta_contract_secret_2026'
      const valid = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`

      expect(verifyMetaSignature(payload, valid, secret)).toBe(true)
      expect(verifyMetaSignature(payload, 'sha256=abcdef1234', secret)).toBe(false)
      expect(verifyMetaSignature(payload, 'sha256=zzzz', secret)).toBe(false)
      expect(verifyMetaSignature(payload, 'malformed', secret)).toBe(false)
      expect(verifyMetaSignature(`${payload}x`, valid, secret)).toBe(false)
    })
  })

  describe('Twilio SMS', () => {
    it('keeps provider error classification deterministic for retryable and terminal HTTP states', () => {
      expect(classifyProviderHttpError(503)).toEqual({ retryable: true, action: 'RETRY' })
      expect(classifyProviderHttpError(429)).toEqual({ retryable: true, action: 'RETRY' })
      expect(classifyProviderHttpError(408)).toEqual({ retryable: true, action: 'RETRY' })
      expect(classifyProviderHttpError(400)).toEqual({ retryable: false, action: 'DLQ' })
      expect(classifyProviderHttpError(401)).toEqual({ retryable: false, action: 'DLQ' })
    })
  })

  describe('Resend / Svix', () => {
    it('validates the canonical Svix v1 signing format and rejects invalid signatures', () => {
      const payload = JSON.stringify({ type: 'email.bounced', data: {} })
      const id = `msg_${crypto.randomUUID()}`
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const secret = `whsec_${crypto.randomBytes(32).toString('base64')}`
      const toSign = `${id}.${timestamp}.${payload}`
      const signature = crypto.createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(toSign).digest('base64')
      const headers = { id, timestamp, signatures: `v1,${signature}` }

      expect(verifySvixSignature(payload, headers, secret)).toBe(true)
      expect(verifySvixSignature(payload, { ...headers, signatures: 'v1,invalid' }, secret)).toBe(false)
      expect(verifySvixSignature(`${payload}x`, headers, secret)).toBe(false)
    })
  })

  describe('Canonical delivery RPC — real test/staging PostgreSQL', () => {
    it('preserves READ when a late DELIVERED event arrives', async () => {
      const read = await pool.query(
        `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
        [accountId, externalMessageId, JSON.stringify({ provider: 'contract_test', event_id: 'read-1' })],
      )
      const delivered = await pool.query(
        `select public.crm_record_channel_delivery_status($1,$2,'delivered',$3::jsonb) as result`,
        [accountId, externalMessageId, JSON.stringify({ provider: 'contract_test', event_id: 'delivered-late-1' })],
      )
      const row = await pool.query(
        `select status, metadata->>'delivery_status' as delivery_status, last_error
         from public.crm_channel_message_outbox where id=$1`,
        [outboxId],
      )

      expect(read.rows[0].result.audit_recorded).toBe(true)
      expect(delivered.rows[0].result.ignored_out_of_order).toBe(true)
      expect(row.rows[0].status).toBe('sent')
      expect(row.rows[0].delivery_status).toBe('read')
      expect(row.rows[0].last_error).toBeNull()
    })

    it('records a duplicate provider event once and remains idempotent', async () => {
      const event = JSON.stringify({ provider: 'contract_test', event_id: `duplicate-${outboxId}` })
      const first = await pool.query(
        `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
        [accountId, externalMessageId, event],
      )
      const second = await pool.query(
        `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
        [accountId, externalMessageId, event],
      )

      expect(first.rows[0].result.audit_recorded).toBe(true)
      expect(second.rows[0].result.audit_recorded).toBe(false)
      expect(second.rows[0].result.ignored_out_of_order).toBe(false)
    })
  })
})
