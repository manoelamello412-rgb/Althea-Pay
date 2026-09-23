import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const checkout = readFileSync('supabase/functions/checkout-engine-v2/index.ts', 'utf8')
const gateway = readFileSync('supabase/functions/gateway-webhook/index.ts', 'utf8')
const gatewayProcessor = readFileSync('supabase/functions/gateway-webhook-processor/index.ts', 'utf8')

function listTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listTsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

describe('release prerequisite runtime callers', () => {
  it('routes checkout sale and integration-event writes through guarded RPCs', () => {
    expect(checkout).toContain('db.rpc("server_upsert_transaction_sale_v1"')
    expect(checkout).toContain('db.rpc("server_insert_integration_event_v1"')
    expect(checkout).toContain('.eq("organization_id", organizationId)')
    expect(checkout).not.toContain('db.from("sales").insert(')
    expect(checkout).not.toContain('db.from("integration_events").insert(')
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
    expect(gatewayProcessor).toContain('if (canonicalEventProjected) return')
  })

  it('fences all gateway webhook runtimes behind G1-A RPCs', () => {
    expect(gateway).toContain('server_claim_gateway_webhook_events_v1')
    expect(gateway).toContain('server_process_claimed_gateway_webhook_v1')
    expect(gatewayProcessor).toContain('server_claim_gateway_webhook_events_v1')
    expect(gatewayProcessor).toContain('server_process_claimed_gateway_webhook_v1')

    const functionFiles = listTsFiles('supabase/functions')

    const directV11Callers = functionFiles
      .filter((path) => readFileSync(path, 'utf8').includes('process_gateway_webhook_v11'))
      .map((path) => relative('.', path).replaceAll('\\', '/'))
      .sort()

    const directQueueTableAccess = functionFiles
      .filter((path) =>
        /\.from\(\s*["']gateway_webhook_events["']\s*\)/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative('.', path).replaceAll('\\', '/'))
      .sort()

    expect(directV11Callers).toEqual([])
    expect(directQueueTableAccess).toEqual([])
  })
})
