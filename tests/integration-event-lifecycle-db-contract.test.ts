import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920052221_integration_event_lifecycle_contract.sql',
  'utf8',
).toLowerCase()

describe('integration event lifecycle DB contract', () => {
  it('keeps existing canonical lifecycle RPCs service-role only', () => {
    expect(migration).toContain('create or replace function public.claim_integration_event')
    expect(migration).toContain('create or replace function public.mark_integration_event_processed')
    expect(migration).toContain('create or replace function public.schedule_integration_event_retry')
    expect(migration.match(/auth\.role\(\) <> 'service_role'/g)?.length).toBeGreaterThanOrEqual(6)
    expect(migration).toContain('from public, anon, authenticated')
  })

  it('protects processed/retry transitions from invalid lifecycle state', () => {
    expect(migration).toContain("p_status not in ('processed','retry')")
    expect(migration).toContain("v_current_status <> 'processing'")
    expect(migration).toContain('integration_event_invalid_transition')
    expect(migration).toContain('next_retry_at=null')
    expect(migration).toContain('claimed_at=null')
  })

  it('provides a narrow retry transition preserving counters and optional delay', () => {
    expect(migration).toContain('server_retry_integration_event_v1')
    expect(migration).toContain('p_increment_retry_count boolean default false')
    expect(migration).toContain('v_retry_count:=v_retry_count+1')
    expect(migration).toContain('p_delay_seconds is null')
    expect(migration).toContain("status='retry'")
  })

  it('provides event-worker claim semantics without making claim generic', () => {
    expect(migration).toContain('server_claim_integration_event_worker_v1')
    expect(migration).toContain("v_status not in ('pending','failed','retry','received')")
    expect(migration).toContain('retry_count=v_retry_count')
    expect(migration).toContain('claim_attempt=coalesce(claim_attempt,0)+1')
  })

  it('preserves failed/dead-letter and exponential retry semantics for the worker', () => {
    expect(migration).toContain('server_record_integration_event_failure_v1')
    expect(migration).toContain("v_status:='dead_letter'")
    expect(migration).toContain("v_status:='failed'")
    expect(migration).toContain('power(2,v_retry_count)')
    expect(migration).toContain('p_max_retries integer default 5')
    expect(migration).toContain('p_max_delay_seconds integer default 300')
  })

  it('does not revoke transitional direct integration_events update yet', () => {
    expect(migration).not.toMatch(
      /revoke\s+update\s+on\s+(?:table\s+)?public\.integration_events\s+from\s+service_role/i,
    )
    expect(migration).toContain('privilege-tightening migration')
    expect(migration).toContain('after #111-a is live')
  })

  it('does not introduce arbitrary table DML grants', () => {
    expect(migration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+(?:table\s+)?public\.integration_events/i)
    expect(migration).not.toContain('grant all')
  })
})
