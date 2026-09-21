import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('advanced CRM organization authorization', () => {
  const readRecovery = readFileSync(
    'supabase/migrations/20260919213138_advanced_crm_org_read_recovery.sql',
    'utf8',
  )
  const ai = readFileSync(
    'supabase/migrations/20260919213321_advanced_crm_ai_org_authorization.sql',
    'utf8',
  )
  const aiRoute = readFileSync('app/api/crm/ai-agent/route.ts','utf8')
  const kernel = readFileSync('services/iara-agent/execution-kernel.ts','utf8')
  const registry = readFileSync('services/iara-agent/tool-registry.ts','utf8')

  it('authorizes Customer 360 and predictive intelligence through organization capabilities', () => {
    expect(readRecovery).toContain('private.crm_access_context')
    expect(readRecovery).toContain("private.has_org_capability(v_org,'can_view_values')")
    expect(readRecovery).toContain("private.has_org_capability(v_org,'can_view_customers')")
    expect(readRecovery).toContain('deterministic_behavioral_v2_org')
    expect(readRecovery).toContain('actor_id')
  })

  it('keeps recovery organization-scoped and never returns the public conversation token', () => {
    expect(readRecovery).toContain('organization_id=v_org')
    expect(readRecovery).toContain("not private.has_org_capability(v_org,'can_reply_chats')")
    const executeBody = readRecovery.slice(readRecovery.indexOf('create or replace function public.crm_recovery_execute'))
    expect(executeBody).not.toContain("'conversation_token'")
    expect(executeBody).toContain("'actor_id',v_actor")
  })

  it('stores operation-owner attribution separately from the internal AI actor', () => {
    expect(ai).toContain('add column if not exists actor_id')
    expect(ai).toContain('v_owner')
    expect(ai).toContain('v_actor')
    expect(ai).toContain("'operation_owner_user_id',v_owner")
    expect(ai).toContain("'tenant_scope','organization_id'")
  })

  it('allows the transient executing state required by atomic AI execution', () => {
    expect(ai).toContain("'executing'::text")
    expect(ai).toContain("status='executing'")
    expect(ai).toContain("status='executed'")
  })

  it('routes AI ledger reads/writes through organization-aware RPCs', () => {
    expect(aiRoute).toContain("rpc('crm_ai_actions_list'")
    expect(aiRoute).toContain("rpc('crm_ai_action_create'")
    expect(aiRoute).not.toContain("from('crm_ai_actions')")
    expect(aiRoute).toContain("source:'crm_ai_agent'")
    expect(aiRoute).toContain("['suggested','accepted','dismissed']")
  })

  it('executes through an organization-scoped human approval kernel', () => {
    expect(kernel).toContain("rpc('crm_ai_action_get'")
    expect(kernel).toContain("tool.authorization !== 'organization_operator'")
    expect(kernel).toContain("tool.tenantScope !== 'organization_id'")
    expect(kernel).toContain("action.status !== 'accepted'")
    expect(registry).toContain("authorization: 'organization_operator'")
    expect(registry).toContain("tenantScope: 'organization_id'")
  })

  it('normalizes recommendation probability to the UI percent scale', () => {
    expect(aiRoute).toContain('n>=0&&n<=1?n*100:n')
  })
})
