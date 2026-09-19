import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('CRM capability authorization rollout', () => {
  const core = readFileSync(
    'supabase/migrations/20260919210035_crm_capability_authorization_core.sql',
    'utf8',
  )
  const rpcFix = readFileSync(
    'supabase/migrations/20260919210126_fix_crm_capability_rpc_private_schema_access.sql',
    'utf8',
  )
  const accessFix = readFileSync(
    'supabase/migrations/20260919210148_fix_organization_access_rpc_private_schema.sql',
    'utf8',
  )

  it('moves CRM reads to organization scope plus effective capabilities', () => {
    expect(core).toContain('crm_conversations_org_read')
    expect(core).toContain("private.has_org_capability(organization_id,'can_view_chats')")
    expect(core).toContain("private.has_org_capability(organization_id,'can_view_values')")
    expect(core).toContain('private.org_operational_history_hours')
    expect(core).toContain('private.current_organization_id()')
  })

  it('keeps direct write policies conservative while RPCs are migrated', () => {
    expect(core).toContain('crm_conversations_owner_update')
    expect(core).toContain('user_id = auth.uid()')
    expect(core).toContain('crm_messages_owner_insert')
  })

  it('requires reply capability for operator mutations', () => {
    for (const fn of [
      'crm_operator_mark_read',
      'crm_operator_set_status',
      'crm_assign_conversation',
      'crm_operator_send_message',
    ]) {
      expect(core).toContain(fn)
    }
    expect(core.match(/can_reply_chats/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  it('preserves owner attribution while recording the real sender', () => {
    expect(core).toContain('c.user_id')
    expect(core).toContain('v_actor')
    expect(core).toContain("'actor_id',v_actor")
    expect(core).toContain('sender_id')
  })

  it('runs server-side access RPCs as definers because private schema is not client-visible', () => {
    expect(rpcFix.match(/security definer/g)?.length).toBe(2)
    expect(accessFix).toContain('security definer')
    expect(accessFix).toMatch(/grant execute on function public\.organization_my_access_v1\(uuid\) to authenticated/i)
  })
})
