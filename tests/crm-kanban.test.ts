import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261013170000_crm_kanban_v1.sql', 'utf8')
const page = readFileSync('app/dashboard/kanban/page.tsx', 'utf8')
const body = (fn: string) => migration.slice(migration.indexOf(`function public.${fn}(`), migration.indexOf('$function$;', migration.indexOf(`function public.${fn}(`)))

describe('CRM kanban contract', () => {
  it('is read-only for clients: writes only through audited RPCs', () => {
    expect(migration).toMatch(/revoke all on public\.crm_pipelines, public\.crm_stages, public\.crm_pipeline_cards from anon, authenticated/)
    expect(migration).toMatch(/grant select on public\.crm_pipelines, public\.crm_stages, public\.crm_pipeline_cards to authenticated;/)
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*crm_(pipelines|stages|pipeline_cards)/)
    for (const [fn, action] of [['crm_pipeline_save', 'crm.pipeline.saved'], ['crm_card_add', 'crm.card.added'], ['crm_card_move', 'crm.card.moved']]) {
      expect(body(fn)).toContain('insert into public.audit_logs')
      expect(body(fn)).toContain(`'${action}'`)
    }
  })

  it('scopes every RPC to the current organization and its capabilities', () => {
    expect(body('crm_pipeline_save')).toContain("has_org_capability(v_org, 'can_manage_funnels')")
    for (const fn of ['crm_card_add', 'crm_card_move']) {
      expect(body(fn)).toContain('private.current_organization_id()')
      expect(body(fn)).toContain("has_org_capability(v_org, 'can_view_customers')")
      expect(body(fn)).toContain("has_org_capability(v_org, 'can_reply_chats')")
    }
    expect(migration).toContain("using (private.has_org_capability(organization_id, 'can_view_customers'))")
  })

  it('keeps a card inside its pipeline and rejects stale moves', () => {
    expect(migration).toContain('foreign key (stage_id, pipeline_id) references public.crm_stages(id, pipeline_id) on delete restrict')
    expect(body('crm_card_move')).toContain("'CARD_VERSION_CONFLICT'")
    expect(body('crm_card_move')).toContain('for update')
  })

  it('moves cards with the expected version and listens to realtime', () => {
    expect(page).toContain("db.rpc('crm_card_move', { p_card_id: card.id, p_stage_id: stageId, p_expected_version: card.version })")
    expect(page).toContain("table: 'crm_pipeline_cards'")
    expect(page).not.toMatch(/\.eq\('user_id'/)
  })
})
