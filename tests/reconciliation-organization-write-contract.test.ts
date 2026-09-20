import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920055208_reconciliation_server_write_contract.sql',
  'utf8',
)

describe('reconciliation organization-aware DB contract', () => {
  it('keeps broad reconciliation DML disabled', () => {
    expect(migration).toContain('broad service_role reconciliation DML already exists')
    expect(migration).toContain('broad DML must remain disabled')
    expect(migration).not.toMatch(/grant\s+(?:insert|update).*reconciliation_(?:runs|items).*service_role/i)
  })

  it('creates only narrow SECURITY DEFINER reconciliation writers', () => {
    expect(migration).toContain('server_create_reconciliation_run_v1')
    expect(migration).toContain('server_insert_reconciliation_item_v1')
    expect(migration).toContain('server_finish_reconciliation_run_v1')
    expect(migration.match(/security definer/gi)?.length).toBeGreaterThanOrEqual(3)
    expect(migration.match(/auth\.role\(\) <> 'service_role'/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('validates gateway and run tenant boundaries', () => {
    expect(migration).toContain('g.user_id=p_user_id and g.organization_id=p_organization_id')
    expect(migration).toContain('reconciliation_gateway_tenant_mismatch')
    expect(migration).toContain('r.id=p_run_id and r.user_id=p_user_id and r.organization_id=p_organization_id')
    expect(migration).toContain('reconciliation_run_tenant_mismatch')
  })

  it('validates transaction tenant and gateway when applicable', () => {
    expect(migration).toContain('t.id=p_transaction_id')
    expect(migration).toContain('t.user_id=p_user_id')
    expect(migration).toContain('t.organization_id=p_organization_id')
    expect(migration).toContain('(v_gateway_id is null or t.gateway_id=v_gateway_id)')
    expect(migration).toContain('reconciliation_transaction_tenant_mismatch')
  })

  it('persists organization_id on runs and items', () => {
    expect(migration).toContain('user_id,organization_id,gateway_id')
    expect(migration).toContain('user_id,organization_id,run_id,transaction_id')
  })

  it('only allows running runs to become terminal', () => {
    expect(migration).toContain("p_status not in ('completed','failed')")
    expect(migration).toContain("if v_current_status <> 'running' then return false")
  })

  it('grants execute only to service_role', () => {
    expect(migration.match(/from public, anon, authenticated;/g)?.length).toBeGreaterThanOrEqual(3)
    expect(migration.match(/to service_role;/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
