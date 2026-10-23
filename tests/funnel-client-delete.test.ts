import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261023020000_funnel_client_delete_v1.sql', 'utf8')

describe('funnel and client delete', () => {
  it('funnels go to the bin, scoped to the current org and gated by can_manage_funnels', () => {
    expect(migration).toContain("private.has_org_capability(v_org, 'can_manage_funnels')")
    expect(migration).toContain('update public.funnels set deleted_at = now()')
    expect(migration).toContain('where id = p_funnel_id and organization_id = v_org')
  })

  it('clients are removed only by owner/admin/manager of the org, never with subscriptions', () => {
    expect(migration).toContain("private.has_org_role(v_org, array['owner', 'admin', 'manager'])")
    expect(migration).toContain('CLIENT_HAS_SUBSCRIPTIONS')
    expect(migration).toContain('delete from public.clients where id = p_client_id and organization_id = v_org')
  })

  it('both screens call the RPCs', () => {
    expect(readFileSync('app/dashboard/funil/page.tsx', 'utf8')).toContain("rpc('funnel_delete'")
    expect(readFileSync('app/dashboard/clientes/page.tsx', 'utf8')).toContain("rpc('client_delete'")
  })
})
