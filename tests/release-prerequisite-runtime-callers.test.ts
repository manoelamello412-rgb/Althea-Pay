import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const checkout = readFileSync('supabase/functions/checkout-engine-v2/index.ts', 'utf8')
const reconciliation = readFileSync('supabase/functions/reconciliation-worker/index.ts', 'utf8')
const gatewayProcessor = readFileSync('supabase/functions/gateway-webhook-processor/index.ts', 'utf8')

describe('release prerequisite runtime callers', () => {
  it('routes checkout sale and integration-event writes through guarded RPCs', () => {
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

  it('authenticates and tenant-scopes gateway automation dispatch', () => {
    expect(gatewayProcessor).toContain('"x-internal-secret": internalSecret')
    expect(gatewayProcessor).toContain('organization_id: tx.organization_id')
    expect(gatewayProcessor).toContain('external_id: `gateway_webhook_event:${webhookId}`')
    expect(gatewayProcessor).not.toContain(
      'user_id: event.user_id ?? null, event_id: webhookId',
    )
  })

  it('does not pretend gateway_webhook_events.id is integration_events.id', () => {
    expect(gatewayProcessor).toContain('gateway_webhook_event_id: webhookId')
    expect(gatewayProcessor).not.toContain('event_id: webhookId, event_type:')
  })

  it('avoids duplicate automation when checkout-engine already emitted the canonical event', () => {
    expect(gatewayProcessor).toContain('canonicalEventProjected')
    expect(gatewayProcessor).toContain(
      'String(txMetadata.source ?? "") === "checkout-engine-v2"',
    )
    expect(gatewayProcessor).toContain('if (!canonicalEventProjected) await callAutomation')
  })
})
