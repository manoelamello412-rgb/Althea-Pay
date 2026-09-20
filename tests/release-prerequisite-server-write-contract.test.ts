import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260920044201_release_prerequisite_server_write_contract.sql', 'utf8')
const checkout = readFileSync('supabase/functions/checkout-engine-v2/index.ts', 'utf8')
const reconciliation = readFileSync('supabase/functions/reconciliation-worker/index.ts', 'utf8')
const gatewayProcessor = readFileSync('supabase/functions/gateway-webhook-processor/index.ts', 'utf8')

describe('release prerequisite server write contract', () => {
  it('keeps broad service-role table DML disabled', () => {
    expect(migration).toContain("unexpected broad service_role DML grant already exists")
    expect(migration).toContain("broad service_role table DML must remain disabled")
    expect(migration).not.toMatch(/grant\s+(?:insert|update|insert\s*,\s*update).*public\.(?:sales|integration_events).*service_role/i)
  })

  it('exposes only guarded SECURITY DEFINER RPCs to service_role', () => {
    expect(migration).toContain('server_insert_integration_event_v1')
    expect(migration).toContain('server_upsert_transaction_sale_v1')
    expect(migration).toContain('server_update_sale_status_v1')
    expect(migration.match(/security definer/gi)?.length).toBeGreaterThanOrEqual(3)
    expect(migration.match(/auth\.role\(\) <> 'service_role'/g)?.length).toBeGreaterThanOrEqual(3)
    expect(migration).toContain('funnel_tenant_mismatch')
    expect(migration).toContain('transaction_tenant_mismatch')
    expect(migration).toContain('sale_external_id_ambiguous')
    expect(migration).toContain('sale_external_id_conflict')
  })

  it('retires runtime execution of unsafe legacy projectors without deleting them', () => {
    expect(migration).toContain('revoke execute on function public.project_funnel_event(uuid) from service_role')
    expect(migration).toContain('revoke execute on function public.project_checkout_purchase(uuid) from service_role')
    expect(migration).not.toMatch(/drop\s+function\s+.*project_(?:funnel_event|checkout_purchase)/i)
  })

  it('routes checkout sale and event writes through canonical RPCs', () => {
    expect(checkout).toContain('db.rpc("server_upsert_transaction_sale_v1"')
    expect(checkout).toContain('db.rpc("server_insert_integration_event_v1"')
    expect(checkout).toContain('.eq("organization_id", organizationId)')
    expect(checkout).not.toContain('db.from("sales").insert(')
    expect(checkout).not.toContain('db.from("integration_events").insert(')
  })

  it('routes reconciliation sale mutation through the guarded RPC', () => {
    expect(reconciliation).toContain('select("id,user_id,organization_id,data")')
    expect(reconciliation).toContain('db.rpc("server_update_sale_status_v1"')
    expect(reconciliation).toContain('p_organization_id: gateway.organization_id')
    expect(reconciliation).not.toContain('db.from("sales").update(')
  })

  it('makes gateway automation dispatch authenticated and organization-aware', () => {
    expect(gatewayProcessor).toContain('"x-internal-secret": internalSecret')
    expect(gatewayProcessor).toContain('organization_id: tx.organization_id')
    expect(gatewayProcessor).toContain('external_id: `gateway_webhook_event:${webhookId}`')
    expect(gatewayProcessor).not.toContain('event_id: webhookId')
  })

  it('avoids duplicate direct automation when checkout-engine already projects a canonical integration event', () => {
    expect(gatewayProcessor).toContain('canonicalEventProjected')
    expect(gatewayProcessor).toContain('String(txMetadata.source ?? "") === "checkout-engine-v2"')
    expect(gatewayProcessor).toContain('if (!canonicalEventProjected) await callAutomation')
  })
})
