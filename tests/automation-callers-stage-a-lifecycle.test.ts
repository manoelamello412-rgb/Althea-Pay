import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const webhook = readFileSync('supabase/functions/althea-webhook/index.ts', 'utf8')
const worker = readFileSync('supabase/functions/event-worker/index.ts', 'utf8')
const funnel = readFileSync('supabase/functions/funnel-events/index.ts', 'utf8')

describe('automation callers stage A lifecycle contract', () => {
  it('removes direct integration_events updates from all stage-A callers', () => {
    for (const source of [webhook, worker, funnel]) {
      expect(source).not.toContain('.from("integration_events").update')
      expect(source).not.toContain(".from('integration_events').update")
    }
  })

  it('routes althea-webhook success and retry through lifecycle RPCs', () => {
    expect(webhook).toContain("db.rpc('mark_integration_event_processed'")
    expect(webhook).toContain("db.rpc('server_retry_integration_event_v1'")
    expect(webhook).toContain('p_increment_retry_count: true')
    expect(webhook).toContain('p_delay_seconds: null')
  })

  it('preserves event-worker claim counters, failure backoff, and dead-letter behavior', () => {
    expect(worker).toContain('db.rpc("server_claim_integration_event_worker_v1"')
    expect(worker).toContain('db.rpc("mark_integration_event_processed"')
    expect(worker).toContain('db.rpc("server_record_integration_event_failure_v1"')
    expect(worker).toContain('p_max_retries: 5')
    expect(worker).toContain('p_max_delay_seconds: 300')
    expect(worker).toContain('failureState.status === "dead_letter"')
    expect(worker).toContain('db.from("event_dead_letters").insert')
  })

  it('preserves funnel immediate and delayed retry semantics through RPCs', () => {
    expect(funnel).toContain('p_error:"CRM_CONVERSATION_NOT_FOUND",p_delay_seconds:null')
    expect(funnel).toContain('p_error:e instanceof Error?e.message:"crm_sync_failed",p_delay_seconds:null')
    expect(funnel).toContain('p_error:e instanceof Error?e.message:"crm_funnel_chat_sync_failed",p_delay_seconds:60')
    expect(funnel).toContain('p_error:automation,p_delay_seconds:60')
    expect(funnel).toContain('db.rpc("mark_integration_event_processed"')
  })

  it('keeps organization context in automation dispatches', () => {
    expect(webhook).toContain('organization_id: organizationId')
    expect(worker).toContain('organization_id: event.organization_id')
    expect(funnel).toContain('organization_id:funnel.organization_id')
  })
})
