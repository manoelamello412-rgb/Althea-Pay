import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('server-side revenue analytics', () => {
  it('keeps analytics tenant-aware and authenticated-only', async () => {
    const source = await readFile('supabase/migrations/20260918173619_revenue_analytics_v26.sql', 'utf8')

    expect(source).toContain('revenue_analytics_v1')
    expect(source).toContain('private.is_org_member(v_org)')
    expect(source).toContain('t.organization_id=v_org')
    expect(source).toContain('c.organization_id=v_org')
    expect(source).toContain('from public,anon')
    expect(source).toContain('to authenticated')
  })

  it('aggregates current and previous periods, daily buckets, funnels and gateways in postgres', async () => {
    const source = await readFile('supabase/migrations/20260918173619_revenue_analytics_v26.sql', 'utf8')

    expect(source).toContain('previous_tx as')
    expect(source).toContain('previous_checkout as')
    expect(source).toContain('calendar as')
    expect(source).toContain("'approval_rate'")
    expect(source).toContain("'checkout_conversion'")
    expect(source).toContain("'recovery_active'")
    expect(source).toContain("'gateways'")
    expect(source).toContain("'status_distribution'")
  })

  it('adds organization-oriented indexes for analytics filters', async () => {
    const source = await readFile('supabase/migrations/20260918173619_revenue_analytics_v26.sql', 'utf8')

    expect(source).toContain('gateway_transactions_org_funnel_created_idx')
    expect(source).toContain('gateway_transactions_org_gateway_created_idx')
    expect(source).toContain('checkout_sessions_org_funnel_created_idx')
  })

  it('removes 10k browser-side transaction and checkout scans', async () => {
    const source = await readFile('app/dashboard/analytics/page.tsx', 'utf8')

    expect(source).toContain("rpc('revenue_analytics_v1'")
    expect(source).not.toContain(".limit(10000)")
    expect(source).not.toContain("from('gateway_transactions')")
    expect(source).not.toContain("from('checkout_sessions')")
    expect(source).toContain('Desempenho por gateway')
    expect(source).toContain('Recuperação ativa')
    expect(source).toContain('vs. período anterior')
  })
})
