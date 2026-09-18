import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('Revenue Sources and Integration Hub', () => {
  it('creates an RLS-protected Revenue Source catalog with the agreed extensible types', async () => {
    const migration = await readFile('supabase/migrations/20260918185132_revenue_sources_integration_hub_v38.sql', 'utf8')

    expect(migration).toContain('create table if not exists public.revenue_sources')
    expect(migration).toContain('alter table public.revenue_sources enable row level security')
    expect(migration).toContain('revenue_sources_org_type_ref_uidx')
    expect(migration).toContain("'funnel','direct_checkout','payment_link','subscription','affiliate'")
    expect(migration).toContain("'marketplace','store','manual_sale','external_api','custom'")
    expect(migration).toContain('private.is_org_member(revenue_sources.organization_id)')
    expect(migration).toContain('private.has_org_role')
    expect(migration).toContain('revoke all on table public.revenue_sources from anon')
  })

  it('keeps funnel as source of truth and synchronizes the catalog by trigger', async () => {
    const migration = await readFile('supabase/migrations/20260918185132_revenue_sources_integration_hub_v38.sql', 'utf8')
    const hardDelete = await readFile('supabase/migrations/20260918185518_revenue_sources_funnel_delete_sync_v39.sql', 'utf8')

    expect(migration).toContain('private.sync_funnel_revenue_source')
    expect(migration).toContain('trg_sync_funnel_revenue_source')
    expect(migration).toContain("source_type='funnel'")
    expect(migration).toContain('from public.funnels f')
    expect(hardDelete).toContain('private.archive_funnel_revenue_source')
    expect(hardDelete).toContain('after delete on public.funnels')
    expect(hardDelete).toContain("status='archived'")
  })

  it('derives Integration Hub progress server-side from real operational state', async () => {
    const migration = await readFile('supabase/migrations/20260918185132_revenue_sources_integration_hub_v38.sql', 'utf8')

    expect(migration).toContain('integration_hub_overview_v1')
    expect(migration).toContain("when c.id is null then 'needs_connection'")
    expect(migration).toContain("then 'needs_credential'")
    expect(migration).toContain("then 'awaiting_first_event'")
    expect(migration).toContain("else 'operational'")
    expect(migration).toContain("'first_event_received'")
    expect(migration).toContain("'product_linked'")
    expect(migration).toContain("'gateway_linked'")
    expect(migration).toContain("'remote_control_ready'")
    expect(migration).toContain('least(coalesce(p_limit,100),200)')
  })

  it('does not return credential material from the Integration Hub overview', async () => {
    const migration = await readFile('supabase/migrations/20260918185132_revenue_sources_integration_hub_v38.sql', 'utf8')
    const overview = migration.slice(migration.indexOf('create or replace function public.integration_hub_overview_v1'))

    expect(overview).not.toContain("'token_hash'")
    expect(overview).not.toContain("'key_hash'")
    expect(overview).not.toContain("'secret_hash'")
    expect(overview).not.toContain("'credential_secret_id'")
  })

  it('keeps funnel provisioning connection-first with optional product and gateway', async () => {
    const route = await readFile('app/api/funnels/provision/route.ts', 'utf8')
    const workspace = await readFile('components/funnel-create-workspace.tsx', 'utf8')
    const selector = await readFile('app/dashboard/funil/funnel-commercial-selector.tsx', 'utf8')

    expect(route).toContain('const productId = optionalId(body?.product_id)')
    expect(route).toContain('const gatewayId = optionalId(body?.gateway_id)')
    expect(route).toContain('p_product_id: productId')
    expect(route).toContain('p_gateway_id: gatewayId')
    expect(workspace).not.toContain("setError('Selecione um produto ativo para o funil.')")
    expect(workspace).not.toContain("setError('Selecione um gateway operacional para o funil.')")
    expect(workspace).toContain('disabled={saving || !name.trim()}')
    expect(selector).toContain('Produto · opcional')
    expect(selector).toContain('Gateway de pagamento · opcional')
    expect(selector).not.toContain(".order('priority'")
  })

  it('uses one canonical creation workspace for funnel and Integration Hub onboarding', async () => {
    const funnelRoute = await readFile('app/dashboard/funil/novo/page.tsx', 'utf8')
    const integrationRoute = await readFile('app/dashboard/integration-hub/connect/page.tsx', 'utf8')
    const workspace = await readFile('components/funnel-create-workspace.tsx', 'utf8')

    expect(funnelRoute).toContain('FunnelCreateWorkspace')
    expect(integrationRoute).toContain('FunnelCreateWorkspace context="integration"')
    expect(workspace).toContain("context?: 'funnel' | 'integration'")
    expect(workspace).toContain("fetch('/api/funnels/provision'")
  })

  it('turns Integration Hub into an RPC-backed control plane rather than client-side history scans', async () => {
    const hub = await readFile('app/dashboard/integration-hub/page.tsx', 'utf8')

    expect(hub).toContain("rpc('integration_hub_overview_v1'")
    expect(hub).toContain('Revenue Sources')
    expect(hub).toContain('/dashboard/integration-hub/connect')
    expect(hub).toContain('first_event_received')
    expect(hub).not.toContain(".from('integration_events')")
    expect(hub).not.toContain(".from('funnel_connections')")
  })

  it('preserves the secure one-time browser connector handoff', async () => {
    const workspace = await readFile('components/funnel-create-workspace.tsx', 'utf8')
    const funnel = await readFile('app/dashboard/funil/page.tsx', 'utf8')

    expect(workspace).toContain('clientTokenEndpoint')
    expect(workspace).toContain('browserSdkUrl')
    expect(funnel).toContain('Não exponha a credencial longa no navegador')
    expect(funnel).toContain('Browser short-lived token endpoint')
    expect(funnel).toContain('Browser SDK')
  })
})
