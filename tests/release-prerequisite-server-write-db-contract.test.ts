import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920044201_release_prerequisite_server_write_contract.sql',
  'utf8',
)

describe('release prerequisite server write DB contract', () => {
  it('keeps broad service-role table DML disabled', () => {
    expect(migration).toContain('unexpected broad service_role DML grant already exists')
    expect(migration).toContain('broad service_role table DML must remain disabled')
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|insert\s*,\s*update).*public\.(?:sales|integration_events).*service_role/i,
    )
  })

  it('exposes only guarded SECURITY DEFINER RPCs to service_role', () => {
    expect(migration).toContain('server_insert_integration_event_v1')
    expect(migration).toContain('server_upsert_transaction_sale_v1')
    expect(migration).toContain('server_update_sale_status_v1')
    expect(migration.match(/security definer/gi)?.length).toBeGreaterThanOrEqual(6)
    expect(migration.match(/auth\.role\(\) <> 'service_role'/g)?.length).toBeGreaterThanOrEqual(6)
    expect(migration).toContain('funnel_tenant_mismatch')
    expect(migration).toContain('integration_tenant_mismatch')
    expect(migration).toContain('transaction_tenant_mismatch')
    expect(migration).toContain('sale_transaction_tenant_mismatch')
    expect(migration).toContain('sale_external_id_ambiguous')
    expect(migration).toContain('sale_external_id_conflict')
  })

  it('grants execute only to service_role for the new write RPCs', () => {
    expect(migration).toContain(
      'grant execute on function public.server_insert_integration_event_v1(',
    )
    expect(migration).toContain(
      'grant execute on function public.server_upsert_transaction_sale_v1(',
    )
    expect(migration).toContain(
      'grant execute on function public.server_update_sale_status_v1(',
    )
    expect(migration.match(/from public, anon, authenticated;/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('adds narrow tenant-aware integration-event lifecycle RPCs', () => {
    expect(migration).toContain('server_claim_integration_event_v1')
    expect(migration).toContain('server_complete_integration_event_v1')
    expect(migration).toContain('server_fail_integration_event_v1')
    expect(migration).toContain("organization_id=p_organization_id")
    expect(migration).toContain("p_next_status not in ('retry','failed','dead_letter')")
    expect(migration).toContain("v_status not in ('pending','processing','retry','received','failed')")
    expect(migration).toContain('claim_attempt=coalesce(v_claim_attempt,0)+1')
    expect(migration).toContain('p_increment_retry_count')
    expect(migration).toContain('next_retry_at=p_next_retry_at')
    expect(migration).toContain('processed_at=now()')
  })

  it('keeps integration_events UPDATE as an explicit transitional privilege', () => {
    expect(migration).toContain('broad UPDATE on integration_events is intentionally NOT revoked')
    expect(migration).toContain('later privilege-tightening migration')
    expect(migration).not.toMatch(/revoke\s+update\s+on\s+(?:table\s+)?public\.integration_events/i)
  })

  it('retires service-role execution of unsafe legacy projectors without deleting them', () => {
    expect(migration).toContain(
      'revoke execute on function public.project_funnel_event(uuid) from service_role',
    )
    expect(migration).toContain(
      'revoke execute on function public.project_checkout_purchase(uuid) from service_role',
    )
    expect(migration).not.toMatch(
      /drop\s+function\s+.*project_(?:funnel_event|checkout_purchase)/i,
    )
  })

  it('post-validates RPC access and legacy projector revocation', () => {
    expect(migration).toContain('server_write_contract_post_guard')
    expect(migration).toContain(
      "has_function_privilege('service_role','public.project_funnel_event(uuid)','EXECUTE')",
    )
    expect(migration).toContain(
      "has_function_privilege('service_role','public.project_checkout_purchase(uuid)','EXECUTE')",
    )
  })
})
