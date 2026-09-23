import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const processor = readFileSync(
  'supabase/functions/gateway-webhook-processor/index.ts',
  'utf8',
)
const gateway = readFileSync('supabase/functions/gateway-webhook/index.ts', 'utf8')
const helper = readFileSync(
  'supabase/functions/_shared/gateway-webhook-normalization.ts',
  'utf8',
)
const g1a = readFileSync(
  'supabase/migrations/20260921040000_gateway_webhook_processing_contract_v1.sql',
  'utf8',
)

function listTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listTsFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

describe('G1-B gateway webhook runtime fencing', () => {
  it('uses batch claim 50 and targeted claim 1 with the requested webhook id', () => {
    expect(processor).toContain('p_limit: requested ? 1 : 50')
    expect(processor).toContain('p_webhook_id: requested || null')
    expect(gateway).toContain('p_limit: 1')
    expect(gateway).toContain('p_webhook_id: webhookId')
  })

  it('propagates claim_attempt as the expected fencing token in both runtimes', () => {
    expect(processor).toContain('const claimAttempt = Number(event.claim_attempt ?? 0)')
    expect(processor).toContain('p_expected_attempt: claimAttempt')
    expect(gateway).toContain('const claimAttempt = Number(claim.claim_attempt ?? 0)')
    expect(gateway).toContain('p_expected_attempt: claimAttempt')
  })

  it('treats an empty targeted claim as a normal race and preserves healthy empty queue semantics', () => {
    expect(gateway).toContain('reason: "processing_claim_unavailable"')
    expect(gateway).toMatch(/processing_claim_unavailable"[\s\S]{0,120}\},\s*202/)
    expect(processor).toContain('scanned: events.length')
    expect(processor).toContain('claimed: events.length')
    expect(processor).toContain('processed,')
    expect(processor).toContain('failed,')
    expect(processor).toContain('dead_lettered: deadLettered')
  })

  it('treats fencing loss as lease loss without direct-table recovery or v11 fallback', () => {
    expect(processor).toContain('gateway_webhook_fencing_lost')
    expect(gateway).toContain('gateway_webhook_fencing_lost')
    expect(processor).not.toContain('process_gateway_webhook_v11')
    expect(gateway).not.toContain('process_gateway_webhook_v11')
    expect(processor).not.toMatch(/\.from\(\s*["']gateway_webhook_events["']\s*\)/)
    expect(gateway).not.toMatch(/\.from\(\s*["']gateway_webhook_events["']\s*\)/)
  })

  it('delegates retry backoff to G1-A and dead-letters attempt 8 without creating attempt 9', () => {
    expect(processor).toContain('server_fail_gateway_webhook_event_v1')
    expect(processor).toContain('server_dead_letter_gateway_webhook_event_v1')
    expect(processor).toContain('if (claimAttempt >= 8)')
    expect(processor).not.toContain('2 **')
    expect(processor).not.toContain('next_attempt_at')
    expect(processor).not.toMatch(/claimAttempt\s*\+\s*1/)
    expect(g1a).toContain('(30 * power(2::numeric,p_expected_attempt-1))::integer')
    expect(g1a).toContain('p_expected_attempt>=8')
    expect(g1a).toContain('else e.attempts+1')
    expect(g1a).toContain('and e.attempts <= 8')
  })

  it('dead-letters deterministic parser errors immediately', () => {
    expect(processor).toContain('"external_transaction_id_missing"')
    expect(processor).toContain('"unsupported_provider_status"')
    const firstPermanentError = processor.indexOf('"external_transaction_id_missing"')
    const processRpc = processor.indexOf('"server_process_claimed_gateway_webhook_v1"')
    expect(firstPermanentError).toBeGreaterThan(-1)
    expect(processRpc).toBeGreaterThan(firstPermanentError)
  })

  it('leaves stale-processing recovery with the G1-A claim RPC', () => {
    expect(g1a).toContain("e.status='processing'")
    expect(g1a).toContain("e.updated_at <= now() - interval '5 minutes'")
    expect(processor).toContain('"server_claim_gateway_webhook_events_v1"')
    expect(processor).not.toContain('updated_at: new Date().toISOString()')
  })

  it('preserves duplicate ingest and incomplete payload 202 behavior', () => {
    const duplicateIndex = gateway.indexOf('if (row?.duplicate)')
    const claimIndex = gateway.indexOf('"server_claim_gateway_webhook_events_v1"')
    expect(duplicateIndex).toBeGreaterThan(-1)
    expect(claimIndex).toBeGreaterThan(duplicateIndex)
    expect(gateway).toContain('reason: "awaiting_normalized_transaction_fields"')
    expect(gateway).toMatch(/awaiting_normalized_transaction_fields"[\s\S]{0,120}\},\s*202/)
  })

  it('normalizes authorized to approved while keeping legacy-only aliases out of the shared contract', () => {
    expect(helper).toContain('authorized: "approved"')
    expect(helper).toContain('succeeded: "approved"')
    expect(helper).toContain('waiting: "pending"')
    expect(helper).toContain('failure: "failed"')
    expect(helper).not.toMatch(/^\s*complete:\s/m)
    expect(helper).not.toMatch(/^\s*denied:\s/m)
    expect(helper).not.toMatch(/^\s*charged_back:\s/m)
    expect(helper).not.toMatch(/^\s*dispute:\s/m)
    expect(gateway).toContain('complete: "approved"')
    expect(gateway).toContain('denied: "failed"')
    expect(gateway).toContain('dispute: "chargeback"')
    expect(processor).toContain('charged_back: "chargeback"')
  })

  it('extracts top-level financial fields before payload.data fallback without flattening', () => {
    const topLevel = helper.indexOf(
      'const topLevel = firstUsableGatewayWebhookValue(payload, keys)',
    )
    const dataFallback = helper.indexOf(
      'const data = isGatewayWebhookRecord(payload.data) ? payload.data : null',
    )
    expect(topLevel).toBeGreaterThan(-1)
    expect(dataFallback).toBeGreaterThan(topLevel)
    expect(helper).toContain('return data ? firstUsableGatewayWebhookValue(data, keys) : undefined')
    expect(gateway).not.toContain('{...payload,...payload.data}')
    expect(gateway).not.toContain('{ ...payload, ...payload.data }')
    expect(processor).not.toContain('{...payload,...payload.data}')
    expect(processor).not.toContain('{ ...payload, ...payload.data }')
  })

  it('preserves provider signature handling including Mercado Pago data.id', () => {
    expect(gateway).toContain('provider === "stripe"')
    expect(gateway).toContain('provider === "asaas"')
    expect(gateway).toContain('provider === "mercado_pago"')
    expect(gateway).toContain('url.searchParams.get("data.id")')
    expect(gateway).toContain('rec(payload.data) ? String(payload.data.id ?? "") : ""')
    expect(gateway).toContain('"resolve_gateway_webhook_secret"')
    expect(gateway).toContain('rawBody.length > 1024 * 1024')
    expect(gateway).toContain('"ingest_gateway_webhook_v2"')
  })

  it('keeps automation post-processing best-effort and suppresses checkout-engine-v2 duplicates', () => {
    expect(processor).toContain('async function dispatchAutomationBestEffort')
    expect(processor).toContain('"automation_post_processing_failed"')
    expect(processor).toContain('String(txMetadata.source ?? "") === "checkout-engine-v2"')
    expect(processor).toContain('if (canonicalEventProjected) return')
    expect(processor).toContain('"x-internal-secret": internalSecret')
    const processRpc = processor.indexOf('"server_process_claimed_gateway_webhook_v1"')
    const automation = processor.indexOf('await dispatchAutomationBestEffort(')
    expect(processRpc).toBeGreaterThan(-1)
    expect(automation).toBeGreaterThan(processRpc)
  })

  it('has zero direct v11 callers and zero direct queue-table access in Edge Functions', () => {
    const functionFiles = listTsFiles('supabase/functions')
    const v11 = functionFiles
      .filter((path) => readFileSync(path, 'utf8').includes('process_gateway_webhook_v11'))
      .map((path) => relative('.', path).replaceAll('\\', '/'))
    const queueTable = functionFiles
      .filter((path) =>
        /\.from\(\s*["']gateway_webhook_events["']\s*\)/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative('.', path).replaceAll('\\', '/'))

    expect(v11).toEqual([])
    expect(queueTable).toEqual([])
  })
})
