import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261013210000_crm_calls_v1.sql', 'utf8')
const page = readFileSync('app/dashboard/kanban/page.tsx', 'utf8')
const body = migration.slice(migration.indexOf('function public.crm_call_log('), migration.indexOf('$function$;', migration.indexOf('function public.crm_call_log(')))

describe('CRM calls contract', () => {
  it('is read-only for clients: attempts are written only through the audited RPC', () => {
    expect(migration).toContain('revoke all on public.crm_call_attempts from anon, authenticated;')
    expect(migration).toContain('grant select on public.crm_call_attempts to authenticated;')
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*crm_call_attempts/)
    expect(migration).toContain("using (private.has_org_capability(organization_id, 'can_view_customers'))")
    expect(body).toContain('insert into public.audit_logs')
    expect(body).toContain("'crm.call.logged'")
  })

  it('scopes the RPC to the current organization and the card-move capabilities', () => {
    expect(body).toContain('private.current_organization_id()')
    expect(body).toContain("has_org_capability(v_org, 'can_view_customers')")
    expect(body).toContain("has_org_capability(v_org, 'can_reply_chats')")
    expect(body).toContain('where id = p_client_id and organization_id = v_org')
    expect(body).toContain('where id = p_card_id and organization_id = v_org')
    expect(body).toContain('v_card.client_id <> p_client_id')
  })

  it('is idempotent by caller-generated attempt id without leaking across organizations', () => {
    expect(body).toContain("'ATTEMPT_ID_REQUIRED'")
    expect(body).toMatch(/if v_attempt\.organization_id <> v_org then raise exception 'FORBIDDEN'/)
    expect(body).toContain("'replayed', true")
    expect(page).toContain('attemptId: crypto.randomUUID()')
    expect(page).toContain('p_attempt_id: call.attemptId')
  })

  it('updates the Kanban stage through crm_card_move with the expected version', () => {
    expect(body).toContain("kind = case p_outcome when 'converted' then 'won' else 'lost' end")
    expect(body).toContain('public.crm_card_move(v_card.id, v_attempt.to_stage_id, coalesce(p_expected_version, v_card.version))')
    expect(body).toContain("'CARD_REQUIRED_FOR_STAGE'")
    expect(body).toContain("'CALLBACK_AT_REQUIRED'")
    expect(page).toContain('p_expected_version: call.card.version')
    expect(page).not.toMatch(/\.eq\('user_id'/)
  })
})
