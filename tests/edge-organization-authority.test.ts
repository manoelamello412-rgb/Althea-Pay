import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (fn: string) => readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8')

describe('edge function organization authority', () => {
  const migration = readFileSync('supabase/migrations/20261013150000_organization_member_authority_v1.sql', 'utf8')

  it('keeps a single capability rule shared by RLS and service callers', () => {
    expect(migration).toContain('select private.member_has_org_capability(target_org, auth.uid(), requested_capability)')
    expect(migration).toContain('grant execute on function public.organization_member_authority_v1(uuid,uuid,text[]) to service_role')
    expect(migration).toMatch(/revoke all on function public\.organization_member_authority_v1[^;]*authenticated/)
  })

  it('authorizes member-facing functions by organization capability, not the caller user_id', () => {
    const cases: Array<[string, string]> = [
      ['gateway-connection-test', 'can_manage_gateways'],
      ['outbound-webhook-management', 'can_manage_integrations'],
      ['iara-ai-core', 'can_view_values'],
      ['iara-copilot', 'can_reply_chats'],
    ]
    for (const [fn, capability] of cases) {
      const code = source(fn)
      expect(code, fn).toContain('organizationAuthority(')
      expect(code, fn).toContain(capability)
    }
    expect(source('gateway-connection-test')).not.toContain('.eq("user_id", userId)')
    expect(source('outbound-webhook-management')).not.toContain('.eq("user_id", user.id)')
    expect(source('iara-copilot')).not.toContain(".eq('user_id',au.data.user.id)")
  })

  it('writes outbound webhooks under the organization owner so the dispatcher fires them', () => {
    expect(source('outbound-webhook-management')).toContain('user_id: authority!.owner_user_id ?? user.id')
  })

  it('never hands IARA values or customers without the capability', () => {
    const code = source('iara-ai-core')
    expect(code).toContain("q('sales',!scope.values?denied:")
    expect(code).toContain("q('transactions',!scope.values?denied:")
    expect(code).toContain("name==='crm_search'&&!(scope.chats&&scope.customers)")
    expect(code).not.toMatch(/from\('(sales|gateway_transactions|checkout_sessions|crm_conversations|funnels|gateways)'\)[^;]*eq\('user_id',userId\)/)
  })
})
