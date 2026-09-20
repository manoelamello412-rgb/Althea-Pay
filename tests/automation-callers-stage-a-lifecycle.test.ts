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

  it('routes althea-webhook success and retry through tenant-aware lifecycle RPCs', () => {
    expect(webhook).toContain("db.rpc('server_complete_integration_event_v1'")
    expect(webhook).toContain("db.rpc('server_fail_integration_event_v1'")
    expect(webhook).toContain('p_organization_id: organizationId')
    expect(webhook).toContain('p_organization_id: tenantOrganizationId')
    expect(webhook).toContain("p_expected_status: 'processing'")
  })

  it('preserves event-worker claim counters, failure backoff, and dead-letter behavior', () => {
    expect(worker).toContain('db.rpc("server_claim_integration_event_v1"')
    expect(worker).toContain('p_increment_retry_count: true')
    expect(worker).toContain('db.rpc("server_complete_integration_event_v1"')
    expect(worker).toContain('db.rpc("server_fail_integration_event_v1"')
    expect(worker).toContain('const terminal = retryCount >= 5')
    expect(worker).toContain('Math.min(300_000, 2 ** retryCount * 1000)')
    expect(worker).toContain('p_next_status: terminal ? "dead_letter" : "failed"')
    expect(worker).toContain('db.from("event_dead_letters").insert')
  })

  it('preserves funnel immediate and delayed retry semantics through tenant-aware RPCs', () => {
    expect(funnel).toContain('p_error:"CRM_CONVERSATION_NOT_FOUND",p_next_retry_at:null')
    expect(funnel).toContain('p_error:e instanceof Error?e.message:"crm_sync_failed",p_next_retry_at:null')
    expect(funnel).toContain('p_error:e instanceof Error?e.message:"crm_funnel_chat_sync_failed",p_next_retry_at:new Date(Date.now()+60000).toISOString()')
    expect(funnel).toContain('p_error:automation,p_next_retry_at:new Date(Date.now()+60000).toISOString()')
    expect(funnel).toContain('db.rpc("server_claim_integration_event_v1"')
    expect(funnel).toContain('db.rpc("server_complete_integration_event_v1"')
    expect(funnel).toContain('db.rpc("server_fail_integration_event_v1"')
  })

  it('keeps organization context in lifecycle and automation dispatches', () => {
    expect(webhook).toContain('organization_id: organizationId')
    expect(worker).toContain('p_organization_id: event.organization_id')
    expect(funnel).toContain('p_organization_id:funnel.organization_id')
    expect(worker).toContain('organization_id: event.organization_id')
    expect(funnel).toContain('organization_id:funnel.organization_id')
  })
})
