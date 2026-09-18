import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('funnel remote command control plane', () => {
  test('global gateway UI uses the verified command engine, never the retired internal-only switch', () => {
    const ui = source('components/dynamic-gateway-connector.tsx')
    expect(ui).toContain("request_global_funnel_gateway_switch")
    expect(ui).toContain("funnel-command-worker")
    expect(ui).toContain("request_funnel_gateway_rollback")
    expect(ui).not.toContain("switch_all_funnel_primary_gateways")
  })

  test('remote worker verifies state before finalizing local gateway bindings', () => {
    const worker = source('supabase/functions/funnel-command-worker/index.ts')
    expect(worker).toContain('"get_gateway"')
    expect(worker).toContain('"set_gateway"')
    expect(worker).toContain('observedBefore === targetRemoteGatewayRef')
    expect(worker).toContain('observedAfter !== targetRemoteGatewayRef')
    expect(worker).toContain('finalize_funnel_gateway_switch_target')
    expect(worker).toContain('p_batch_id: batchId')
  })

  test('provider adapter blocks unsafe targets and redirects', () => {
    const adapter = source('supabase/functions/funnel-provider-adapter/index.ts')
    expect(adapter).toContain('assertPublicHttpsUrl')
    expect(adapter).toContain('target.origin !== base.origin')
    expect(adapter).toContain('redirect: "error"')
    expect(adapter).toContain('resolve_funnel_connection_secret')
  })

  test('connection credentials are stored behind service-only Vault RPCs', () => {
    const migration = source('supabase/migrations/20260918040711_funnel_remote_command_control_plane_v1.sql')
    expect(migration).toContain('vault.create_secret')
    expect(migration).toContain('vault.update_secret')
    expect(migration).toContain('grant execute on function public.resolve_funnel_connection_secret(uuid) to service_role')
    expect(migration).toContain('revoke all on function public.resolve_funnel_connection_secret(uuid) from public, anon, authenticated')
  })

  test('legacy authenticated global switch is revoked', () => {
    const migration = source('supabase/migrations/20260918042319_funnel_command_immediate_batch_claim_and_legacy_lockdown_v3.sql')
    expect(migration).toContain('revoke execute on function public.switch_all_funnel_primary_gateways(text) from authenticated')
    expect(migration).toContain('grant execute on function public.switch_all_funnel_primary_gateways(text) to service_role')
  })

  test('drift detection and rollback remain part of the canonical runtime', () => {
    const drift = source('supabase/functions/funnel-drift-worker/index.ts')
    const migration = source('supabase/migrations/20260918043540_funnel_gateway_rollback_and_drift_foundation_v5.sql')
    expect(drift).toContain('funnel_control_drift_events')
    expect(drift).toContain('observed_gateway_id')
    expect(migration).toContain('request_funnel_gateway_rollback')
    expect(migration).toContain("command_type in ('gateway_switch','gateway_rollback')")
  })
})
