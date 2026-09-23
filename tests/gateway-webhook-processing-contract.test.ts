import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260921040000_gateway_webhook_processing_contract_v1.sql',
  'utf8',
)
const normalized = migration.replace(/\s+/g, ' ').toLowerCase()

describe('gateway webhook processing contract v1', () => {
  it('pre-guards the live contract and preserves direct-table DML lockdown', () => {
    expect(migration).toContain('g1a_pre_guard: gateway_webhook_events missing')
    expect(migration).toContain('g1a_pre_guard: process_gateway_webhook_v11 fingerprint mismatch')
    expect(migration).toContain('gateway-scoped webhook identity duplicates exist')
    expect(migration).toContain('legacy null-gateway webhook identity duplicates exist')
    expect(migration).toContain(
      "has_table_privilege('service_role','public.gateway_webhook_events','SELECT')",
    )
    expect(migration).toContain(
      "has_table_privilege('service_role','public.gateway_webhook_events','INSERT')",
    )
    expect(migration).toContain(
      "has_table_privilege('service_role','public.gateway_webhook_events','UPDATE')",
    )
    expect(migration).toContain(
      "has_table_privilege('service_role','public.gateway_webhook_events','DELETE')",
    )
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete).*gateway_webhook_events.*service_role/i,
    )
  })

  it('moves webhook identity to gateway-scoped plus legacy-null scoped uniques', () => {
    expect(normalized).toContain(
      'create unique index if not exists gateway_webhook_events_gateway_provider_event_id_key on public.gateway_webhook_events(gateway_id,provider,provider_event_id) where gateway_id is not null',
    )
    expect(normalized).toContain(
      'create unique index if not exists gateway_webhook_events_legacy_provider_event_id_key on public.gateway_webhook_events(provider,provider_event_id) where gateway_id is null',
    )
    expect(normalized).toContain(
      'alter table public.gateway_webhook_events drop constraint gateway_webhook_events_provider_provider_event_id_key',
    )
    expect(migration).toContain('global webhook identity constraint still exists')
  })

  it('keeps v2 duplicate resolution gateway-scoped without overwriting redelivery payloads', () => {
    expect(normalized).toContain(
      'on conflict (gateway_id,provider,provider_event_id) where gateway_id is not null do nothing',
    )
    expect(normalized).toContain(
      'where e.gateway_id=v_gateway_id and e.provider=v_provider and e.provider_event_id=v_provider_event_id',
    )
    expect(migration).not.toMatch(
      /on conflict\s*\(gateway_id,provider,provider_event_id\)[\s\S]*do update/i,
    )
  })

  it('preserves legacy NULL-gateway identity after the global unique is removed', () => {
    expect(normalized).toContain(
      'on conflict (provider,provider_event_id) where gateway_id is null do nothing',
    )
    expect(normalized).toContain(
      'where e.gateway_id is null and e.provider=v_provider and e.provider_event_id=v_provider_event_id',
    )
  })

  it('creates the exact four narrow queue RPCs', () => {
    expect(migration).toContain('server_claim_gateway_webhook_events_v1')
    expect(migration).toContain('server_process_claimed_gateway_webhook_v1')
    expect(migration).toContain('server_fail_gateway_webhook_event_v1')
    expect(migration).toContain('server_dead_letter_gateway_webhook_event_v1')
    expect(migration.match(/security definer/gi)?.length).toBeGreaterThanOrEqual(6)
    expect(migration.match(/auth\.role\(\) <> 'service_role'/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('enforces claim bounds, queue eligibility, ordering, lease and SKIP LOCKED', () => {
    expect(migration).toContain('v_limit < 1 or v_limit > 50')
    expect(migration).toContain("(e.status='accepted' and e.attempts < 8)")
    expect(migration).toContain("e.status='failed'")
    expect(migration).toContain('(e.next_attempt_at is null or e.next_attempt_at <= now())')
    expect(migration).toContain("e.status='processing'")
    expect(migration).toContain("e.updated_at <= now() - interval '5 minutes'")
    expect(migration).toContain('order by e.received_at asc, e.id asc')
    expect(migration).toContain('limit case when p_webhook_id is null then v_limit else 1 end')
    expect(migration).toContain('for update skip locked')
  })

  it('uses attempts as the fencing token and never produces attempt 9', () => {
    expect(migration).toContain("when e.status='processing' and e.attempts >= 8 then 'dead_letter'")
    expect(migration).toContain(
      "when e.status='processing' and e.attempts >= 8 then e.attempts",
    )
    expect(migration).toContain('else e.attempts+1')
    expect(migration).toContain('and e.attempts <= 8')
    expect(migration).toContain("where c.status='processing'")
    expect(migration).toContain('p_expected_attempt>=8')
  })

  it('fences success before delegating financial work to v11', () => {
    expect(normalized).toContain(
      "where e.id=p_webhook_id and e.status='processing' and e.attempts=p_expected_attempt for update",
    )
    expect(migration).toContain('gateway_webhook_fencing_lost')
    expect(migration).toContain('tenant_context_missing')
    expect(normalized).toContain(
      'where g.id=v_event.gateway_id and g.user_id=v_event.user_id and g.organization_id=v_event.organization_id',
    )
    expect(normalized).toContain(
      'where t.gateway_id=v_event.gateway_id and t.user_id=v_event.user_id and t.organization_id=v_event.organization_id and t.external_id=v_external',
    )
    expect(migration).toContain('v_event.transaction_id <> v_tx.id')
    expect(migration).toContain('transaction_tenant_mismatch')
    expect(migration).toContain('select public.process_gateway_webhook_v11(')
    expect(migration).not.toContain('create or replace function public.process_gateway_webhook_v11')
  })

  it('implements server-side retry backoff and idempotent fail fencing', () => {
    expect(migration).toContain("if v_status='failed' then")
    expect(migration).toContain("if v_status<>'processing' or p_expected_attempt>=8 then")
    expect(migration).toContain(
      '(30 * power(2::numeric,p_expected_attempt-1))::integer',
    )
    expect(migration).toContain('make_interval(secs=>v_delay_seconds)')
    expect(migration).toContain('last_error=left(p_error,2000)')
    expect(normalized).toContain(
      "where id=p_webhook_id and status='processing' and attempts=p_expected_attempt",
    )
  })

  it('implements fenced and idempotent dead-letter transition', () => {
    expect(migration).toContain("if v_status='dead_letter' then")
    expect(migration).toContain("if v_status<>'processing' then")
    expect(normalized).toContain(
      "set status='dead_letter', last_error=left(p_error,2000), next_attempt_at=null, updated_at=now()",
    )
  })

  it('keeps processed and dead-letter terminal by exposing no reverse transition', () => {
    expect(migration).not.toMatch(/set\s+status='accepted'/i)
    expect(migration).not.toMatch(/set\s+status='processed'/i)
  })

  it('locks RPC ownership, search_path and execute ACLs to service_role', () => {
    expect(migration.match(/owner to postgres;/g)?.length).toBe(4)
    expect(
      migration.match(
        /revoke all on function public\.server_[^(]+\([^;]+\) from public, anon, authenticated;/g,
      )?.length,
    ).toBe(4)
    expect(
      migration.match(
        /grant execute on function public\.server_[^(]+\([^;]+\) to service_role;/g,
      )?.length,
    ).toBe(4)
    expect(migration).toContain("ARRAY['search_path=pg_catalog, public']")
    expect(migration).toContain('PUBLIC execute remains on gateway webhook RPC')
  })

  it('post-validates identity, ingest contracts, v11 fingerprint and transitional EXECUTE', () => {
    expect(migration).toContain('g1a_post_guard')
    expect(migration).toContain('gateway-scoped webhook identity index missing')
    expect(migration).toContain('legacy null-gateway identity index missing')
    expect(migration).toContain('legacy ingest is not null-gateway scoped')
    expect(migration).toContain('v2 ingest is not gateway scoped')
    expect(migration).toContain('process_gateway_webhook_v11 changed unexpectedly')
    expect(migration).toContain('service_role must retain v11 execute during G1-A')
    expect(migration).not.toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.process_gateway_webhook_v11[\s\S]*from\s+service_role/i,
    )
  })
})
