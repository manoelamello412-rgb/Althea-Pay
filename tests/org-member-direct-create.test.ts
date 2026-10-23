import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('direct member creation', () => {
  const migration = readFileSync('supabase/migrations/20261022230000_org_member_direct_create_v1.sql', 'utf8')
  const route = readFileSync('app/api/members/route.ts', 'utf8')

  it('joins the target org from service-only app_metadata and never grants owner', () => {
    expect(migration).toContain("new.raw_app_meta_data ? 'althea_member_org'")
    expect(migration).toContain("v_role not in('admin','manager','operator','supervisor','viewer')")
    expect(route).toContain('app_metadata: { althea_member_org: access.organization_id')
    // GoTrue writes app_metadata after the insert, so the update trigger is what actually moves the user.
    expect(migration).toContain('after update of raw_app_meta_data on auth.users')
    expect(migration).toContain("o.slug='workspace-'||substr(md5(new.id::text),1,16)")
  })

  it('only lets trusted backends skip the actor check', () => {
    expect(migration).toContain("not in ('anon','authenticated')")
  })

  it('gates every write on can_manage_members and keeps owner/admin protections', () => {
    expect(route).toContain('can_manage_members')
    expect(route).toContain("actorRole === 'owner' || role !== 'admin'")
    expect(route).toContain("data.role === 'owner'")
    expect(route).toContain('SELF_CHANGE_FORBIDDEN')
  })
})
