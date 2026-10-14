import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261014090000_crm_board_call_desk_v1.sql', 'utf8')
const kanban = readFileSync('app/dashboard/kanban/page.tsx', 'utf8')
const desk = readFileSync('app/dashboard/atendimento/page.tsx', 'utf8')
const dialog = readFileSync('components/crm-call-dialog.tsx', 'utf8')
const tasks = readFileSync('app/dashboard/tarefas/page.tsx', 'utf8')
const fn = (name: string) => { const start = migration.indexOf(`function public.${name}(`); return migration.slice(start, migration.indexOf('$function$;', start)) }

describe('CRM board and call desk contract', () => {
  it('assigns the card owner through an audited, versioned, org-scoped RPC', () => {
    const body = fn('crm_card_assign')
    expect(body).toContain("has_org_capability(v_org, 'can_reply_chats')")
    expect(body).toContain("'CARD_VERSION_CONFLICT'")
    expect(body).toContain("'OWNER_NOT_MEMBER'")
    expect(body).toContain("'crm.card.assigned'")
    expect(body).toContain('version = version + 1')
  })

  it('serves board, queue and call context already aggregated, gating chat data and amounts by capability', () => {
    for (const name of ['crm_board_v1', 'crm_call_queue_v1', 'crm_client_call_context_v1']) {
      const body = fn(name)
      expect(body, name).toContain('private.current_organization_id()')
      expect(body, name).toContain("has_org_capability(v_org, 'can_view_customers')")
      expect(migration, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`))
    }
    expect(fn('crm_board_v1')).toContain("case when v_chats then coalesce(tg.tags")
    expect(fn('crm_client_call_context_v1')).toContain("'amount', case when v_values then t.amount end")
  })

  it('links tasks to the customer and keeps the link when a task is edited', () => {
    expect(migration).toContain('alter table public.crm_tasks add column if not exists client_id text references public.clients(id)')
    expect(fn('crm_task_save')).toContain("'CLIENT_NOT_FOUND'")
    expect(fn('crm_task_save')).toContain('v_client := coalesce(v_client, v_conversation_client)')
    expect(tasks).toContain('p_client_id: draft.clientId')
    expect(tasks).toContain('clientId: task.client_id')
  })

  it('renders server data only: the board reads crm_board_v1 and the desk reads crm_call_queue_v1', () => {
    expect(kanban).toContain("db.rpc('crm_board_v1', { p_pipeline_id: active.id })")
    expect(kanban).toContain("db.rpc('crm_card_assign'")
    expect(kanban).not.toContain("from('clients').select('id,data,created_at').in(")
    expect(desk).toContain("db.rpc('crm_call_queue_v1', { p_only_mine: onlyMine })")
    expect(dialog).toContain("db.rpc('crm_client_call_context_v1', { p_client_id: clientId })")
    expect(dialog).toContain("p_client_id: clientId })")
    for (const source of [kanban, desk, dialog]) expect(source).not.toMatch(/\.eq\('user_id'/)
  })
})
