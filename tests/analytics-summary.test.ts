import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261013220000_analytics_summary_rpc_v1.sql', 'utf8')
const page = readFileSync('app/dashboard/analytics/page.tsx', 'utf8')

describe('analytics summary contract', () => {
  it('aggregates on the server instead of downloading rows to the browser', () => {
    expect(page).toContain("db.rpc('analytics_summary_v1'")
    expect(page).not.toMatch(/from\('(gateway_transactions|checkout_sessions)'\)/)
    expect(page).not.toMatch(/\.limit\(10000\)/)
    expect(page).not.toMatch(/user_id/)
  })

  it('scopes every read to the current organization', () => {
    expect(migration).toContain('private.current_organization_id()')
    expect(migration).toContain('private.is_org_member(v_org)')
    for (const table of ['gateway_transactions t', 'checkout_sessions c']) {
      const at = migration.indexOf(`from public.${table}`)
      expect(at).toBeGreaterThan(0)
      expect(migration.slice(at, at + 120)).toContain('organization_id = v_org')
    }
    for (const table of ['funnels', 'products', 'gateways']) expect(migration).toContain(`from public.${table} where organization_id = v_org`)
    expect(migration).not.toMatch(/user_id/)
  })

  it('hides amounts without can_view_values and applies the filters', () => {
    expect(migration).toContain("private.has_org_capability(v_org, 'can_view_values')")
    expect(migration).toContain("'revenue', case when v_values then")
    expect(migration).toContain("'gross', case when v_values and")
    for (const filter of ['p_funnel_id', 'p_product_id', 'p_gateway_id', 'p_status']) expect(migration).toContain(`(${filter} is null or`)
    expect(migration).toContain("raise exception 'INVALID_PERIOD'")
    expect(migration).toMatch(/revoke all on function public\.analytics_summary_v1\([^)]*\) from public, anon;/)
  })
})
