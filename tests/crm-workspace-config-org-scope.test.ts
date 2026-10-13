import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261013180000_crm_workspace_config_org_scope_v1.sql', 'utf8')
const config = readFileSync('app/dashboard/crm/configuracoes/page.tsx', 'utf8')
const body = (fn: string) => migration.slice(migration.indexOf(`function public.${fn}(`), migration.indexOf('$function$;', migration.indexOf(`function public.${fn}(`)))

describe('CRM workspace config organization scope', () => {
  it('replaces owner-only policies with capability reads and RPC-only writes', () => {
    for (const table of ['crm_tasks', 'crm_tags', 'crm_quick_replies', 'crm_channel_accounts']) {
      expect(migration).toContain(`drop policy if exists ${table}_owner on public.${table};`)
      expect(migration).toMatch(new RegExp(`create policy ${table}_org_select on public\\.${table} for select to authenticated using \\(private\\.has_org_capability`))
    }
    expect(migration).toContain('revoke insert, update, delete on public.crm_tasks, public.crm_tags, public.crm_quick_replies, public.crm_channel_accounts from anon, authenticated;')
  })

  it('gates every RPC on a capability, attributes rows to the owner and audits', () => {
    const gates: [string, string][] = [['crm_tag_save', 'can_manage_automations'], ['crm_quick_reply_save', 'can_manage_automations'], ['crm_task_save', 'can_reply_chats'], ['crm_task_set_status', 'can_reply_chats'], ['crm_channel_account_update', 'can_manage_integrations']]
    for (const [fn, capability] of gates) {
      expect(body(fn)).toContain(`private.crm_config_context('${capability}')`)
      expect(body(fn)).toContain('insert into public.audit_logs')
    }
    expect(body('crm_task_save')).toContain('c.owner_id, c.organization_id')
  })

  it('never lets tenants touch channel credentials or provider metadata', () => {
    const update = body('crm_channel_account_update')
    expect(update).not.toMatch(/set[^;]*credentials_ref/)
    expect(update).not.toMatch(/set[^;]*metadata/)
    expect(update).toContain("p_status not in ('active', 'inactive')")
    expect(config).not.toContain('p_credentials_ref')
  })
})
