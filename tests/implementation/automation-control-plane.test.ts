import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const scopeMigration = 'supabase/migrations/20260918214113_automation_organization_scope_v40.sql'
const controlMigration = 'supabase/migrations/20260918214206_automation_control_plane_v41.sql'
const nocMigration = 'supabase/migrations/20260918215126_noc_automation_full_organization_scope_v43.sql'

describe('Automation Control Plane', () => {
  it('scopes rules, executions and attempts by organization with tenant RLS', async () => {
    const sql = await readFile(scopeMigration, 'utf8')

    expect(sql).toContain('alter table public.automation_rules add column if not exists organization_id uuid')
    expect(sql).toContain('alter table public.automation_executions add column if not exists organization_id uuid')
    expect(sql).toContain('alter table public.automation_execution_attempts add column if not exists organization_id uuid')
    expect(sql).toContain('automation_executions_org_rule_key_uidx')
    expect(sql).toContain('private.is_org_member(organization_id)')
    expect(sql).toContain("private.has_org_role(organization_id,array['owner','admin','manager'])")
    expect(sql).toContain('revoke insert,update,delete on table public.automation_rules from authenticated')
    expect(sql).toContain('revoke insert,update,delete on table public.automation_executions from authenticated')
  })

  it('keeps compatibility during rollout while deriving the organization from canonical records', async () => {
    const sql = await readFile(scopeMigration, 'utf8')
    const control = await readFile(controlMigration, 'utf8')

    expect(sql).toContain('private.fill_automation_rule_organization')
    expect(sql).toContain('private.fill_automation_execution_organization')
    expect(control).toContain('crm_check_automation_rate_limit_org')
    expect(control).toContain('select organization_id into v_org from public.automation_rules')
  })

  it('governs rule mutations through validated RPCs and excludes direct financial actions', async () => {
    const sql = await readFile(controlMigration, 'utf8')

    expect(sql).toContain('automation_rule_upsert_v1')
    expect(sql).toContain('automation_rule_delete_v1')
    expect(sql).toContain('automation_operations_v1')
    expect(sql).toContain("'log','alert','send_crm_message','set_conversation_status'")
    expect(sql).toContain("'financial_actions_direct',false")
    expect(sql).toContain('jsonb_array_length(v_actions)>5')
    expect(sql).toContain("jsonb_array_length(p_trigger_config->'conditions')>20")
    expect(sql).not.toContain("'update_transaction','update_sale'")
  })

  it('selects and persists automation runtime state by organization', async () => {
    const engine = await readFile('supabase/functions/automation-engine-v2/index.ts', 'utf8')
    const retry = await readFile('supabase/functions/automation-retry-worker/index.ts', 'utf8')

    expect(engine).toContain('.eq("organization_id",c.organization_id).eq("status","active")')
    expect(engine).toContain('organization_id:c.organization_id')
    expect(engine).toContain('crm_check_automation_rate_limit_org')
    expect(engine).toContain('financial_authority_action_forbidden')
    expect(retry).toContain('crm_check_automation_rate_limit_org')
    expect(retry).toContain('p_organization_id:row.organization_id')
  })

  it('propagates organization id from both canonical event processors', async () => {
    const funnelEvents = await readFile('supabase/functions/funnel-events/index.ts', 'utf8')
    const processor = await readFile('supabase/functions/integration-event-processor/index.ts', 'utf8')

    expect(funnelEvents).toContain('organization_id:funnel.organization_id')
    expect(processor).toContain('organization_id: event.organization_id')
  })

  it('uses RPC-only browser mutations and organization-scoped realtime in the automation UI', async () => {
    const page = await readFile('app/dashboard/automations/page.tsx', 'utf8')

    expect(page).toContain("rpc('automation_operations_v1'")
    expect(page).toContain("rpc('automation_rule_upsert_v1'")
    expect(page).toContain("rpc('automation_rule_delete_v1'")
    expect(page).toContain("rpc('crm_replay_automation_execution'")
    expect(page).toContain("rpc('crm_cancel_automation_execution'")
    expect(page).toContain("table: 'automation_rules'")
    expect(page).toContain("table: 'automation_executions'")
    expect(page).toContain('organization_id=eq.')
    expect(page).not.toContain(".from('automation_rules').insert")
    expect(page).not.toContain(".from('automation_rules').update")
    expect(page).not.toContain(".from('automation_executions').update")
  })

  it('keeps the canonical navigation and NOC drilldown on the automation surface', async () => {
    const shell = await readFile('components/mobile-shell.tsx', 'utf8')
    const nocPage = await readFile('app/dashboard/noc/page.tsx', 'utf8')
    const noc = await readFile(nocMigration, 'utf8')

    expect(shell).toContain("href: '/dashboard/automations'")
    expect(nocPage).toContain("table: 'automation_executions'")
    expect(nocPage).toContain('organization_id=eq.')
    expect(noc).toContain("where a.organization_id=v_org")
    expect(noc).toContain("'/dashboard/automations'")
  })
})
