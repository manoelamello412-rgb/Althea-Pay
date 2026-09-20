import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const worker = readFileSync('supabase/functions/reconciliation-worker/index.ts', 'utf8')

describe('reconciliation worker organization-aware runtime', () => {
  it('derives tenant from gateways and filters transactions by organization', () => {
    expect(worker).toContain('select("id,user_id,organization_id,data")')
    expect(worker).toContain('.eq("organization_id", gateway.organization_id)')
    expect(worker).toContain('"x-althea-organization-id": gateway.organization_id')
    expect(worker).toContain('organization_id: gateway.organization_id')
  })

  it('routes reconciliation writes through narrow RPCs', () => {
    expect(worker).toContain('db.rpc("server_create_reconciliation_run_v1"')
    expect(worker).toContain('db.rpc("server_insert_reconciliation_item_v1"')
    expect(worker).toContain('db.rpc("server_finish_reconciliation_run_v1"')
    expect(worker).not.toContain('db.from("reconciliation_runs").insert')
    expect(worker).not.toContain('db.from("reconciliation_runs").update')
    expect(worker).not.toContain('db.from("reconciliation_items").insert')
  })

  it('persists organization context through every reconciliation writer', () => {
    expect(worker).toContain('p_organization_id: gateway.organization_id')
    expect(worker.match(/p_organization_id: gateway\.organization_id/g)?.length).toBeGreaterThanOrEqual(8)
  })

  it('keeps sale mutation on the canonical #114 RPC', () => {
    expect(worker).toContain('db.rpc("server_update_sale_status_v1"')
    expect(worker).not.toContain('db.from("sales").update')
  })

  it('fails the run when an item RPC fails', () => {
    expect(worker).toContain('if (itemWrite1.error) throw itemWrite1.error')
    expect(worker).toContain('if (itemWrite5.error) throw itemWrite5.error')
  })

  it('preserves terminal run result handling', () => {
    expect(worker).toContain('p_status: "completed"')
    expect(worker).toContain('p_status: "failed"')
    expect(worker).toContain('reconciliation_run_complete_rejected')
    expect(worker).toContain('reconciliation_run_fail_transition_failed')
  })

  it('preserves internal-secret authentication expected by the cron trigger', () => {
    expect(worker).toContain('req.headers.get("x-internal-secret") !== internal')
    expect(worker).toContain('if (req.method !== "POST")')
  })
})
