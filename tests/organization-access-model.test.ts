import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('organization capability foundation', () => {
  const migration = readFileSync(
    'supabase/migrations/20260919204837_organization_capability_foundation.sql',
    'utf8',
  )

  it('defines granular member capabilities', () => {
    for (const capability of [
      'can_view_chats',
      'can_reply_chats',
      'can_view_values',
      'can_manage_gateways',
      'can_change_funnel_gateway',
      'can_view_customers',
      'can_manage_members',
      'can_view_audit',
      'can_manage_funnels',
      'can_manage_products',
      'can_manage_automations',
      'can_manage_integrations',
    ]) {
      expect(migration).toContain(capability)
    }
  })

  it('keeps operational visibility distinct from retention', () => {
    expect(migration).toContain('return 2160')
    expect(migration).toContain('return 48')
    expect(migration).toContain('separate_from_visibility')
  })

  it('prevents self elevation and protects owners/admins', () => {
    expect(migration).toContain('SELF_CAPABILITY_CHANGE_FORBIDDEN')
    expect(migration).toContain('OWNER_CAPABILITIES_IMMUTABLE')
    expect(migration).toContain('ADMIN_CANNOT_MODIFY_ADMIN')
  })

  it('exposes only the effective access contract to authenticated users', () => {
    expect(migration).toContain('organization_my_access_v1')
    expect(migration).toMatch(/revoke all on function public\.organization_my_access_v1\(uuid\) from public, anon/i)
    expect(migration).toMatch(/grant execute on function public\.organization_my_access_v1\(uuid\) to authenticated/i)
  })
})
