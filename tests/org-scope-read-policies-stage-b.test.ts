import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('organization read policies, stage B', () => {
  const migration = readFileSync(
    'supabase/migrations/20261013130000_org_scope_read_policies_stage_b_v1.sql',
    'utf8',
  )

  it('adds and fills organization_id on owner-only tables', () => {
    for (const table of ['api_request_logs', 'outbound_webhooks', 'outbound_webhook_deliveries', 'transaction_routing_logs']) {
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain('execute function private.fill_owner_organization()')
    expect(migration).toContain('p.default_organization_id')
  })

  it('is additive: never drops the existing owner policies', () => {
    expect(migration).not.toMatch(/drop policy if exists \w+_(select|insert)_own/i)
    expect(migration).not.toMatch(/for (insert|update|delete|all)/i)
  })

  it('gates financial and chat-derived reads by capability', () => {
    expect(migration).toContain("has_org_capability(organization_id, 'can_view_values')")
    expect(migration).toContain("has_org_capability(organization_id, 'can_view_chats')")
  })
})
