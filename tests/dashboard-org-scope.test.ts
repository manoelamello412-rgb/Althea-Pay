import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261014110000_dashboard_org_scope_activity_v1.sql', 'utf8')
const dashboard = readFileSync('components/dashboard-production.tsx', 'utf8')
const analytics = readFileSync('app/dashboard/analytics/page.tsx', 'utf8')
const fn = (name: string) => { const start = migration.indexOf(`function ${name}(`); return migration.slice(start, migration.indexOf('$function$;', start)) }

describe('dashboard organization scope contract', () => {
  it('computes the dashboard per organization, never per caller', () => {
    const inner = migration.slice(migration.indexOf('function private.dashboard_production_data_org('), migration.indexOf('revoke all on function private.dashboard_production_data_org'))
    expect(inner).not.toContain('auth.uid()')
    expect(inner.match(/organization_id=p_org/g)?.length).toBe(13)
    expect(inner.match(/user_id=p_owner/g)?.length).toBe(6)
    expect(migration).toContain('revoke all on function private.dashboard_production_data_org(uuid,uuid,date,date,text,text,text,text,text,text,text,text) from public, anon, authenticated;')
  })

  it('checks membership and hides money without can_view_values', () => {
    const body = fn('public.dashboard_production_data_for_user_secure')
    expect(body).toContain('not private.is_org_member(v_org)')
    expect(body).toContain("v_values := private.has_org_capability(v_org, 'can_view_values')")
    for (const path of ["['financial','revenue']", "['clients','ltv']", "['subscriptions','mrr']", "['marketing','revenue']"]) expect(body).toContain(path)
    expect(body).toContain("'revenue',case when v_values then coalesce(sd.revenue,0) end")
  })

  it('serves recent activity gated by each source capability', () => {
    const body = fn('public.dashboard_recent_activity_v1')
    expect(body).toContain("'amount',case when v_values then t.amount end")
    expect(body).toContain('where v_customers and c.organization_id = v_org')
    expect(body).toContain('where v_chats and x.organization_id = v_org')
  })

  it('analytics breaks down by funnel, product and gateway, plus new customers', () => {
    const body = fn('public.analytics_summary_v1')
    for (const key of ["'by_funnel'", "'by_product'", "'by_gateway'", "'leads'"]) expect(body).toContain(key)
    expect(analytics).toContain('rows={summary?.by_product}')
    expect(analytics).toContain('rows={summary?.by_gateway}')
    expect(analytics).toContain('summary.leads.new_customers')
    expect(dashboard).toContain("supabase.rpc('dashboard_recent_activity_v1', { p_limit: 12 })")
    expect(dashboard).not.toContain('dados do usuário autenticado')
  })
})
