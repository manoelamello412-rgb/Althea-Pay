import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const worker = readFileSync('supabase/functions/reconciliation-worker/index.ts', 'utf8')

describe('organization-aware reconciliation runtime', () => {
  it('requires organization context from gateways and filters transactions by it', () => {
    expect(worker).toContain('select("id,user_id,organization_id,data")')
    expect(worker).toContain('.eq("organization_id", gateway.organization_id)')
    expect(worker).toContain('"x-althea-organization-id": gateway.organization_id')
    expect(worker).toContain('organization_id: gateway.organization_id')
  })

  it('creates and finalizes runs only through reconciliation RPCs', () => {
    expect(worker).toContain('db.rpc("server_create_reconciliation_run_v1"')
    expect(worker).toContain('db.rpc("server_finalize_reconciliation_run_v1"')
    expect(worker).not.toContain('db.from("reconciliation_runs").insert')
    expect(worker).not.toContain('db.from("reconciliation_runs").update')
  })

  it('writes reconciliation items only through the tenant-safe RPC', () => {
    expect(worker).toContain('db.rpc("server_insert_reconciliation_item_v1"')
    expect(worker).toContain('p_organization_id: gateway.organization_id')
    expect(worker).not.toContain('db.from("reconciliation_items").insert')
  })

  it('keeps sale mutation on the canonical #114 RPC', () => {
    expect(worker).toContain('db.rpc("server_update_sale_status_v1"')
    expect(worker).toContain('p_organization_id: gateway.organization_id')
    expect(worker).not.toContain('db.from("sales").update')
  })

  it('preserves operational completion and failure outcomes', () => {
    expect(worker).toContain('p_status: "completed"')
    expect(worker).toContain('p_status: "failed"')
    expect(worker).toContain('failed++')
    expect(worker).toContain('return json({ ok: true')
  })
})
