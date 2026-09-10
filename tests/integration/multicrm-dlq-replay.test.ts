import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL_TEST
const testUserId = process.env.ALTHEA_TEST_USER_ID
const run = databaseUrl && testUserId ? describe : describe.skip

run('Multi-CRM DLQ replay and worker crash recovery', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 16 })
  const accountId = crypto.randomUUID()

  beforeAll(async () => {
    await pool.query(
      `insert into public.crm_channel_accounts
        (id,user_id,channel,provider,external_account_id,display_name,status,metadata)
       values ($1,$2,'sms','runtime_test',$3,'DLQ runtime test','active','{}'::jsonb)`,
      [accountId, testUserId, `dlq-runtime-${crypto.randomUUID()}`],
    )
  })

  afterAll(async () => {
    await pool.query('delete from public.crm_channel_outbox_replay_events where user_id=$1', [testUserId])
    await pool.query('delete from public.crm_channel_message_outbox where channel_account_id=$1', [accountId])
    await pool.query('delete from public.crm_channel_accounts where id=$1', [accountId])
    await pool.end()
  })

  it('replays a dead-letter item exactly once for the same replay key', async () => {
    const outboxId = crypto.randomUUID()
    const replayKey = `operator:${crypto.randomUUID()}`

    await pool.query(
      `insert into public.crm_channel_message_outbox
       (id,user_id,channel_account_id,channel,idempotency_key,direction,body,status,attempts,max_attempts,last_error,failed_at)
       values ($1,$2,$3,'sms',$4,'outbound','DLQ test','dead_letter',5,5,'HTTP 504',now())`,
      [outboxId, testUserId, accountId, `dlq:${outboxId}`],
    )

    const first = await pool.query(
      `select public.crm_replay_channel_outbox($1,$2,'manual operator replay') as result`,
      [outboxId, replayKey],
    )
    const second = await pool.query(
      `select public.crm_replay_channel_outbox($1,$2,'manual operator replay') as result`,
      [outboxId, replayKey],
    )

    const row = await pool.query(
      `select status,next_attempt_at,last_error,metadata->'dlq_replay' as replay
       from public.crm_channel_message_outbox where id=$1`,
      [outboxId],
    )
    const events = await pool.query(
      `select count(*)::int as count from public.crm_channel_outbox_replay_events
       where outbox_id=$1 and replay_key=$2`,
      [outboxId, replayKey],
    )

    expect(first.rows[0].result.replayed).toBe(true)
    expect(second.rows[0].result.replayed).toBe(false)
    expect(second.rows[0].result.idempotent).toBe(true)
    expect(row.rows[0].status).toBe('queued')
    expect(row.rows[0].next_attempt_at).not.toBeNull()
    expect(row.rows[0].last_error).toBeNull()
    expect(row.rows[0].replay).not.toBeNull()
    expect(events.rows[0].count).toBe(1)
  })

  it('proves a rolled-back worker claim does not consume the message', async () => {
    const outboxId = crypto.randomUUID()
    await pool.query(
      `insert into public.crm_channel_message_outbox
       (id,user_id,channel_account_id,channel,idempotency_key,direction,body,status,attempts,max_attempts)
       values ($1,$2,$3,'sms',$4,'outbound','crash test','queued',0,3)`,
      [outboxId, testUserId, accountId, `crash:${outboxId}`],
    )

    const crashedWorker = await pool.connect()
    try {
      await crashedWorker.query('begin')
      const claimed = await crashedWorker.query(`select id from public.crm_claim_channel_outbox_worker(1)`)
      expect(claimed.rows).toHaveLength(1)
      expect(claimed.rows[0].id).toBe(outboxId)
      await crashedWorker.query('rollback')
    } finally {
      crashedWorker.release()
    }

    const recovered = await pool.query(`select id,status,attempts from public.crm_claim_channel_outbox_worker(1)`)
    expect(recovered.rows).toHaveLength(1)
    expect(recovered.rows[0].id).toBe(outboxId)
    expect(recovered.rows[0].status).toBe('processing')
    expect(recovered.rows[0].attempts).toBe(1)
  })
})
