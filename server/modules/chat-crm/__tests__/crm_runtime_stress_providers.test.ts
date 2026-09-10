import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import * as crypto from 'node:crypto'

const databaseUrl = process.env.DATABASE_URL_TEST
const testUserId = process.env.ALTHEA_TEST_USER_ID
const run = databaseUrl && testUserId ? describe : describe.skip

function verifyMetaSignature(payload: string, signature: string, secret: string): boolean {
  try {
    if (!signature.startsWith('sha256=')) return false
    const hex = signature.slice(7)
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false
    const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest()
    const actual = Buffer.from(hex, 'hex')
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string, token: string): boolean {
  try {
    if (!signature || !token) return false
    const base = url + Object.keys(params).sort().map((key) => key + params[key]).join('')
    const expected = crypto.createHmac('sha1', token).update(base, 'utf8').digest('base64')
    const actual = Buffer.from(signature, 'utf8')
    const expectedBuffer = Buffer.from(expected, 'utf8')
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer)
  } catch {
    return false
  }
}

function verifySvixSignature(
  payload: string,
  headers: { id: string; timestamp: string; signatures: string },
  secret: string,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  try {
    if (!headers.id || !headers.timestamp || !headers.signatures) return false
    const timestamp = Number(headers.timestamp)
    if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) return false
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
    if (key.length === 0) return false
    const expected = crypto.createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${payload}`, 'utf8').digest()
    return headers.signatures.split(' ').some((part) => {
      if (!part.startsWith('v1,')) return false
      const actual = Buffer.from(part.slice(3), 'base64')
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    })
  } catch {
    return false
  }
}

run('Chat CRM — runtime stress and provider validation', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 40 })
  const accountId = crypto.randomUUID()
  const outboxId = crypto.randomUUID()
  const externalMessageId = `runtime-stress-${crypto.randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into public.crm_channel_accounts
        (id,user_id,channel,provider,external_account_id,display_name,status,metadata)
       values ($1,$2,'whatsapp','runtime_stress',$3,'runtime stress test','active','{}'::jsonb)`,
      [accountId, testUserId, `runtime-${crypto.randomUUID()}`],
    )
    await pool.query(
      `insert into public.crm_channel_message_outbox
        (id,user_id,conversation_id,channel_account_id,channel,external_message_id,
         idempotency_key,direction,body,status,attempts,max_attempts,metadata)
       values ($1,$2,null,$3,'whatsapp',$4,$5,'outbound','runtime stress test',
               'sent',0,3,'{}'::jsonb)`,
      [outboxId, testUserId, accountId, externalMessageId, `runtime-stress:${outboxId}`],
    )
  })

  afterAll(async () => {
    await pool.query('delete from public.crm_channel_delivery_events where channel_account_id=$1', [accountId])
    await pool.query('delete from public.crm_channel_message_outbox where id=$1', [outboxId])
    await pool.query('delete from public.crm_channel_accounts where id=$1', [accountId])
    await pool.end()
  })

  it('sustains 32 concurrent identical READ ACKs with one logical audit event', async () => {
    const event = JSON.stringify({ provider: 'runtime_stress', event_id: `same-${outboxId}` })
    await Promise.all(
      Array.from({ length: 32 }, () =>
        pool.query(
          `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
          [accountId, externalMessageId, event],
        ),
      ),
    )

    const state = await pool.query(
      `select status, metadata->>'delivery_status' as delivery_status
       from public.crm_channel_message_outbox where id=$1`,
      [outboxId],
    )
    const audit = await pool.query(
      `select count(*)::int as count
       from public.crm_channel_delivery_events
       where channel_account_id=$1 and outbox_id=$2`,
      [accountId, outboxId],
    )

    expect(state.rows[0].status).toBe('sent')
    expect(state.rows[0].delivery_status).toBe('read')
    expect(audit.rows[0].count).toBe(1)
  })

  it('keeps READ after 16 concurrent late DELIVERED events', async () => {
    const eventPrefix = `late-${outboxId}`
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        pool.query(
          `select public.crm_record_channel_delivery_status($1,$2,'delivered',$3::jsonb) as result`,
          [accountId, externalMessageId, JSON.stringify({ provider: 'runtime_stress', event_id: `${eventPrefix}-${index}` })],
        ),
      ),
    )

    const state = await pool.query(
      `select status, metadata->>'delivery_status' as delivery_status, last_error
       from public.crm_channel_message_outbox where id=$1`,
      [outboxId],
    )
    expect(state.rows[0].status).toBe('sent')
    expect(state.rows[0].delivery_status).toBe('read')
    expect(state.rows[0].last_error).toBeNull()
  })

  it('validates Meta HMAC-SHA256 without accepting malformed signatures', () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const secret = 'meta_runtime_staging_secret'
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
    expect(verifyMetaSignature(payload, signature, secret)).toBe(true)
    expect(verifyMetaSignature(payload, 'sha256=short', secret)).toBe(false)
    expect(verifyMetaSignature(payload, 'sha256=' + 'z'.repeat(64), secret)).toBe(false)
    expect(verifyMetaSignature(payload + 'x', signature, secret)).toBe(false)
  })

  it('validates Twilio canonical URL and lexicographically sorted parameters', () => {
    const url = 'https://altheapay.com.br/functions/v1/crm-channel-twilio-inbound'
    const params = {
      MessageSid: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      SmsStatus: 'delivered',
      To: '+5511999999999',
      From: '+14155552671',
    }
    const token = 'twilio_runtime_staging_secret'
    const base = url + Object.keys(params).sort().map((key) => key + params[key]).join('')
    const signature = crypto.createHmac('sha1', token).update(base, 'utf8').digest('base64')
    expect(verifyTwilioSignature(url, params, signature, token)).toBe(true)
    expect(verifyTwilioSignature(url, { ...params, Body: 'tampered' }, signature, token)).toBe(false)
  })

  it('validates Svix v1 signatures and rejects replay outside the 300-second window', () => {
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_101' } })
    const id = `evt_${crypto.randomUUID()}`
    const now = Math.floor(Date.now() / 1000)
    const secret = `whsec_${crypto.randomBytes(32).toString('base64')}`
    const signed = `${id}.${now}.${payload}`
    const valid = crypto.createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(signed, 'utf8').digest('base64')
    const headers = { id, timestamp: String(now), signatures: `v1,invalid v1,${valid}` }

    expect(verifySvixSignature(payload, headers, secret, now)).toBe(true)
    expect(verifySvixSignature(payload, { ...headers, timestamp: String(now - 301) }, secret, now)).toBe(false)
    expect(verifySvixSignature(payload, { ...headers, timestamp: 'not-a-timestamp' }, secret, now)).toBe(false)
  })
})
