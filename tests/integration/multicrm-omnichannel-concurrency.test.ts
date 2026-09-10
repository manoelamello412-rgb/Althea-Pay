import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL_TEST
const testUserId = process.env.ALTHEA_TEST_USER_ID
const run = databaseUrl && testUserId ? describe : describe.skip

run('Multi-CRM omnichannel runtime concurrency', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 32 })
  const accountId = crypto.randomUUID()
  const outboxId = crypto.randomUUID()
  const externalMessageId = `runtime-stress-${crypto.randomUUID()}`

  beforeAll(async () => {
    await pool.query(
      `insert into public.crm_channel_accounts
        (id,user_id,channel,provider,external_account_id,display_name,status,metadata)
       values ($1,$2,'whatsapp','runtime_test',$3,'runtime concurrency test','active','{}'::jsonb)`,
      [accountId, testUserId, `runtime-${crypto.randomUUID()}`],
    )

    await pool.query(
      `insert into public.crm_channel_message_outbox
        (id,user_id,conversation_id,channel_account_id,channel,external_message_id,
         idempotency_key,direction,body,status,attempts,max_attempts,metadata)
       values ($1,$2,null,$3,'whatsapp',$4,$5,'outbound','runtime concurrency test',
               'sent',0,3,'{}'::jsonb)`,
      [outboxId, testUserId, accountId, externalMessageId, `runtime:${outboxId}`],
    )
  })

  afterAll(async () => {
    await pool.query('delete from public.crm_channel_delivery_events where channel_account_id=$1', [accountId])
    await pool.query('delete from public.crm_channel_message_outbox where id=$1', [outboxId])
    await pool.query('delete from public.crm_channel_accounts where id=$1', [accountId])
    await pool.end()
  })

  it('serializes concurrent provider acks and never regresses READ', async () => {
    const statuses = [
      'delivered', 'read', 'failed', 'delivered', 'sent', 'read', 'failed', 'delivered',
      'read', 'sent', 'failed', 'delivered', 'read', 'failed', 'sent', 'delivered',
      'read', 'read', 'failed', 'delivered', 'sent', 'read', 'failed', 'delivered',
      'read', 'failed', 'sent', 'delivered', 'read', 'failed', 'delivered', 'read',
    ] as const

    const results = await Promise.all(
      statuses.map((status, index) =>
        pool.query(
          `select public.crm_record_channel_delivery_status($1,$2,$3,$4::jsonb) as result`,
          [accountId, externalMessageId, status, JSON.stringify({ test: 'concurrency', index })],
        ),
      ),
    )

    const row = await pool.query(
      `select status, attempts, last_error, metadata->>'delivery_status' as delivery_status
       from public.crm_channel_message_outbox where id=$1`,
      [outboxId],
    )
    const audits = await pool.query(
      `select status, count(*)::int as count
       from public.crm_channel_delivery_events
       where channel_account_id=$1 and external_message_id=$2
       group by status`,
      [accountId, externalMessageId],
    )

    expect(results).toHaveLength(statuses.length)
    expect(row.rows[0].status).toBe('sent')
    expect(row.rows[0].delivery_status).toBe('read')
    expect(row.rows[0].last_error).toBeNull()
    expect(row.rows[0].attempts).toBe(0)

    const auditByStatus = new Map(audits.rows.map((x) => [x.status, x.count]))
    expect(auditByStatus.get('read')).toBeGreaterThan(0)
    expect(auditByStatus.get('failed')).toBeGreaterThan(0)
    expect(auditByStatus.get('delivered')).toBeGreaterThan(0)
  })

  it('records duplicate provider events without mutating the final monotonic state', async () => {
    const duplicateEvent = JSON.stringify({ test: 'duplicate', provider_event_id: 'same-event' })
    const first = await pool.query(
      `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
      [accountId, externalMessageId, duplicateEvent],
    )
    const second = await pool.query(
      `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
      [accountId, externalMessageId, duplicateEvent],
    )

    expect(first.rows[0].result->>'audit_recorded').toBe('true')
    expect(second.rows[0].result->>'audit_recorded').toBe('false')
    expect(second.rows[0].result->>'ignored_out_of_order').toBe('false')
  })
})
