import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const databaseUrl = process.env.DATABASE_URL_TEST
const testUserId = process.env.ALTHEA_TEST_USER_ID
const run = databaseUrl && testUserId ? describe : describe.skip

run('Chat CRM - canonical runtime concurrency, resilience and dispatcher contracts', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 40 })
  const accountId = crypto.randomUUID()
  const deliveryOutboxId = crypto.randomUUID()
  const deliveryExternalId = `canonical-delivery-${crypto.randomUUID()}`
  const workerOutboxIds: string[] = []
  const crashOutboxId = crypto.randomUUID()
  const dlqOutboxId = crypto.randomUUID()

  beforeAll(async () => {
    await pool.query(
      `insert into public.crm_channel_accounts
        (id,user_id,channel,provider,external_account_id,display_name,status,metadata)
       values ($1,$2,'whatsapp','runtime_test',$3,'canonical runtime test','active','{}'::jsonb)`,
      [accountId, testUserId, `runtime-${crypto.randomUUID()}`],
    )

    await pool.query(
      `insert into public.crm_channel_message_outbox
        (id,user_id,conversation_id,channel_account_id,channel,external_message_id,
         idempotency_key,direction,body,status,attempts,max_attempts,metadata)
       values ($1,$2,null,$3,'whatsapp',$4,$5,'outbound','canonical delivery stress',
               'sent',0,5,'{}'::jsonb)`,
      [deliveryOutboxId, testUserId, accountId, deliveryExternalId, `runtime:${deliveryOutboxId}`],
    )

    for (let i = 0; i < 20; i += 1) {
      const id = crypto.randomUUID()
      workerOutboxIds.push(id)
      await pool.query(
        `insert into public.crm_channel_message_outbox
          (id,user_id,channel_account_id,channel,external_message_id,idempotency_key,
           direction,body,status,attempts,max_attempts,next_attempt_at,metadata)
         values ($1,$2,$3,'email',$4,$5,'outbound',$6,'queued',0,5,now(),'{}'::jsonb)`,
        [id, testUserId, accountId, `worker-${i}-${crypto.randomUUID()}`, `worker:${id}`, `worker stress ${i}`],
      )
    }
  })

  afterAll(async () => {
    await pool.query(
      `delete from public.crm_channel_delivery_events where channel_account_id=$1`,
      [accountId],
    )
    await pool.query(
      `delete from public.crm_channel_outbox_replay_events where outbox_id=$1`,
      [dlqOutboxId],
    )
    await pool.query(
      `delete from public.crm_channel_message_outbox where user_id=$1 and id = any($2::uuid[])`,
      [testUserId, [deliveryOutboxId, ...workerOutboxIds, crashOutboxId, dlqOutboxId]],
    )
    await pool.query(`delete from public.crm_channel_accounts where id=$1`, [accountId])
    await pool.end()
  })

  it('processes 64+ concurrent duplicate/out-of-order provider events and preserves READ', async () => {
    const duplicateRead = JSON.stringify({ provider_event_id: 'canonical-read-duplicate' })
    const duplicateDelivered = JSON.stringify({ provider_event_id: 'canonical-delivered-duplicate' })

    const operations: Promise<unknown>[] = []
    for (let i = 0; i < 32; i += 1) {
      operations.push(
        pool.query(
          `select public.crm_record_channel_delivery_status($1,$2,'delivered',$3::jsonb)`,
          [accountId, deliveryExternalId, duplicateDelivered],
        ),
      )
      operations.push(
        pool.query(
          `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb)`,
          [accountId, deliveryExternalId, duplicateRead],
        ),
      )
      operations.push(
        pool.query(
          `select public.crm_record_channel_delivery_status($1,$2,'sent',$3::jsonb)`,
          [accountId, deliveryExternalId, JSON.stringify({ provider_event_id: `late-sent-${i}` })],
        ),
      )
    }

    const settled = await Promise.allSettled(operations)
    expect(settled.filter((x) => x.status === 'fulfilled')).toHaveLength(96)

    const row = await pool.query(
      `select status,attempts,last_error,metadata->>'delivery_status' as delivery_status
       from public.crm_channel_message_outbox where id=$1`,
      [deliveryOutboxId],
    )
    expect(row.rows[0].status).toBe('sent')
    expect(row.rows[0].delivery_status).toBe('read')
    expect(row.rows[0].attempts).toBe(0)
    expect(row.rows[0].last_error).toBeNull()

    const audits = await pool.query(
      `select status,count(*)::int as count
       from public.crm_channel_delivery_events
       where channel_account_id=$1 and external_message_id=$2
       group by status`,
      [accountId, deliveryExternalId],
    )
    const byStatus = new Map(audits.rows.map((row) => [row.status, row.count]))
    expect(byStatus.get('read')).toBe(1)
    expect(byStatus.get('delivered')).toBe(1)
    expect(byStatus.get('sent')).toBeGreaterThan(0)

    const duplicateAgain = await pool.query(
      `select public.crm_record_channel_delivery_status($1,$2,'read',$3::jsonb) as result`,
      [accountId, deliveryExternalId, duplicateRead],
    )
    expect(duplicateAgain.rows[0].result.audit_recorded).toBe(false)
    expect(duplicateAgain.rows[0].result.ignored_out_of_order).toBe(false)
  })

  it('rolls back an interrupted worker transaction without leaving a phantom outbox row', async () => {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `insert into public.crm_channel_message_outbox
          (id,user_id,channel_account_id,channel,external_message_id,idempotency_key,
           direction,body,status,attempts,max_attempts,metadata)
         values ($1,$2,$3,'sms',$4,$5,'outbound','rollback simulation','queued',0,5,'{}'::jsonb)`,
        [crashOutboxId, testUserId, accountId, `crash-${crashOutboxId}`, `crash:${crashOutboxId}`],
      )
      await client.query('rollback')
    } finally {
      client.release()
    }

    const check = await pool.query(
      `select id from public.crm_channel_message_outbox where id=$1`,
      [crashOutboxId],
    )
    expect(check.rows).toHaveLength(0)
  })

  it('claims queued messages through the canonical worker RPC with zero overlap across 10 workers', async () => {
    const claim = async () => {
      const client = await pool.connect()
      try {
        const result = await client.query(
          `select id from public.crm_claim_channel_outbox_worker($1)`,
          [2],
        )
        return result.rows.map((row) => row.id as string)
      } finally {
        client.release()
      }
    }

    const allClaims = await Promise.all(Array.from({ length: 10 }, () => claim()))
    const claimedIds = allClaims.flat()
    const uniqueIds = new Set(claimedIds)

    expect(claimedIds).toHaveLength(20)
    expect(uniqueIds.size).toBe(20)

    const claimedRows = await pool.query(
      `select count(*)::int as count
       from public.crm_channel_message_outbox
       where id = any($1::uuid[]) and status='processing'`,
      [claimedIds],
    )
    expect(claimedRows.rows[0].count).toBe(20)
  })

  it('recovers stale processing work using the canonical stale-requeue RPC', async () => {
    const staleId = workerOutboxIds[0]
    await pool.query(
      `update public.crm_channel_message_outbox
       set status='processing',attempts=max_attempts,updated_at=now()-interval '30 minutes'
       where id=$1`,
      [staleId],
    )

    const result = await pool.query(
      `select public.crm_requeue_stale_channel_outbox($1) as count`,
      [15],
    )
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(1)

    const row = await pool.query(
      `select status,last_error from public.crm_channel_message_outbox where id=$1`,
      [staleId],
    )
    expect(row.rows[0].status).toBe('dead_letter')
    expect(row.rows[0].last_error).toBe('stale_processing_recovered')
  })

  it('replays a canonical DLQ entry idempotently', async () => {
    await pool.query(
      `insert into public.crm_channel_message_outbox
        (id,user_id,channel_account_id,channel,external_message_id,idempotency_key,
         direction,body,status,attempts,max_attempts,failed_at,last_error,metadata)
       values ($1,$2,$3,'email',$4,$5,'outbound','dlq replay test','dead_letter',5,5,now(),
               'provider_http_400','{}'::jsonb)`,
      [dlqOutboxId, testUserId, accountId, `dlq-${dlqOutboxId}`, `dlq:${dlqOutboxId}`],
    )

    const client = await pool.connect()
    try {
      await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [testUserId])
      const first = await client.query(
        `select public.crm_replay_channel_outbox($1,$2,$3) as result`,
        [dlqOutboxId, `stress-replay-${dlqOutboxId}`, 'canonical stress replay'],
      )
      const second = await client.query(
        `select public.crm_replay_channel_outbox($1,$2,$3) as result`,
        [dlqOutboxId, `stress-replay-${dlqOutboxId}`, 'canonical stress replay'],
      )

      expect(first.rows[0].result.replayed).toBe(true)
      expect(first.rows[0].result.idempotent).toBe(false)
      expect(second.rows[0].result.replayed).toBe(false)
      expect(second.rows[0].result.idempotent).toBe(true)
    } finally {
      client.release()
    }

    const row = await pool.query(
      `select status,last_error,metadata->'dlq_replay' as replay from public.crm_channel_message_outbox where id=$1`,
      [dlqOutboxId],
    )
    expect(row.rows[0].status).toBe('queued')
    expect(row.rows[0].last_error).toBeNull()
    expect(row.rows[0].replay).not.toBeNull()
  })

  describe('dispatcher policy contracts', () => {
    it('keeps retryable and terminal HTTP policies in the canonical dispatcher', () => {
      const path = resolve(process.cwd(), 'supabase/functions/crm-channel-outbox-dispatcher/index.ts')
      expect(existsSync(path)).toBe(true)
      const source = readFileSync(path, 'utf8')

      expect(source).toContain('statusCode === 429')
      expect(source).toContain('statusCode >= 500')
      expect(source).toContain('missing_provider_external_id')
      expect(source).toContain('provider_http_${statusCode}')
      expect(source).toContain("status: 'dead_letter'")
      expect(source).toContain("status: 'queued'")
      expect(source).not.toContain('responseJson')
    })

    it('does not persist provider response bodies as dispatcher errors', () => {
      const path = resolve(process.cwd(), 'supabase/functions/crm-channel-outbox-dispatcher/index.ts')
      const source = readFileSync(path, 'utf8')

      expect(source).not.toContain('last_error: JSON.stringify')
      expect(source).not.toContain('last_error: JSON.stringify(response')
      expect(source).not.toContain('response.body')
    })
  })
})
