import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920052545_reconciliation_server_write_contract.sql',
  'utf8',
).toLowerCase()

describe('reconciliation server write DB contract', () => {
  it('creates only narrow SECURITY DEFINER reconciliation RPCs', () => {
    expect(migration).toContain('server_create_reconciliation_run_v1')
    expect(migration).toContain('server_insert_reconciliation_item_v1')
    expect(migration).toContain('server_finalize_reconciliation_run_v1')
    expect(migration.match(/security definer/g)?.length).toBe(3)
    expect(migration.match(/auth\.role\(\) <> 'service_role'/g)?.length).toBe(3)
  })

  it('validates gateway, run and transaction tenant boundaries', () => {
    expect(migration).toContain('reconciliation_gateway_tenant_mismatch')
    expect(migration).toContain('reconciliation_run_tenant_mismatch')
    expect(migration).toContain('reconciliation_transaction_tenant_mismatch')
    expect(migration).toContain('g.organization_id=p_organization_id')
    expect(migration).toContain('organization_id=p_organization_id')
  })

  it('persists organization_id into runs and items', () => {
    expect(migration).toContain('user_id,organization_id,gateway_id')
    expect(migration).toContain('user_id,organization_id,run_id,transaction_id')
  })

  it('protects run lifecycle and final totals', () => {
    expect(migration).toContain("p_status not in ('completed','failed')")
    expect(migration).toContain("v_current_status not in ('pending','running')")
    expect(migration).toContain('net_expected=v_net_expected')
    expect(migration).toContain('net_reported=v_net_reported')
  })

  it('keeps direct reconciliation DML disabled for service_role', () => {
    expect(migration).toContain('direct reconciliation dml must remain disabled')
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete).*public\.reconciliation_(?:runs|items).*service_role/i,
    )
    expect(migration).not.toContain('grant all')
  })

  it('revokes privileged RPC access from client roles', () => {
    expect(migration.match(/from public, anon, authenticated/g)?.length).toBe(3)
    expect(migration).toContain('privileged rpc exposed to client role')
  })
})
