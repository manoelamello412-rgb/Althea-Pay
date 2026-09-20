import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('integration-event-processor organization boundary', () => {
  const source = readFileSync(
    'supabase/functions/integration-event-processor/index.ts',
    'utf8',
  )

  it('requires a valid persisted organization before processing operational records', () => {
    expect(source).toContain('integration_event_organization_invalid')
    expect(source).toContain('db.from("organizations").select("id").eq("id", organizationId).maybeSingle()')
    expect(source).toContain('integration_event_organization_not_found')
  })

  it('keeps organization in the transaction and checkout boundary', () => {
    expect(source).toContain(
      'db.from("gateway_transactions").select("*").eq("id", transactionId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle()',
    )
    expect(source).toContain(
      'db.from("checkout_sessions").select("id,user_id,organization_id").eq("id", checkoutId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle()',
    )
    expect(source).toContain('transaction_tenant_mismatch_or_not_found')
    expect(source).toContain('checkout_tenant_mismatch_or_not_found')
  })

  it('uses the guarded transaction-first sale upsert RPC', () => {
    expect(source).toContain('db.rpc("server_upsert_transaction_sale_v1"')
    expect(source).toContain('p_organization_id: organizationId')
    expect(source).toContain('p_transaction_id: tx.id')
    expect(source).toContain('p_external_id: externalId')
    expect(source).not.toContain('db.from("sales").insert(')
  })

  it('routes reversal through the guarded ambiguity-safe status RPC', () => {
    expect(source).toContain('db.rpc("server_update_sale_status_v1"')
    expect(source).toContain('p_transaction_id: tx?.id ?? null')
    expect(source).toContain('p_external_id: externalId')
    expect(source).not.toContain('db.from("sales").update(')
  })

  it('passes canonical sale_id downstream to the automation engine', () => {
    expect(source).toContain('sale_id: saleId')
  })

  it('preserves event claim/retry and already-processed idempotency through the canonical lifecycle RPCs', () => {
    expect(source).toContain('db.rpc("server_claim_integration_event_v1"')
    expect(source).toContain('p_increment_retry_count: false')
    expect(source).toContain('db.rpc("server_complete_integration_event_v1"')
    expect(source).toContain('db.rpc("server_fail_integration_event_v1"')
    expect(source).toContain('p_expected_status: "processing"')
    expect(source).toContain('p_next_status: "retry"')
    expect(source).toContain('already_processed: true')
    expect(source).toContain('.eq("organization_id", organizationId).maybeSingle()')
    expect(source).not.toContain('db.rpc("claim_integration_event"')
    expect(source).not.toContain('db.rpc("mark_integration_event_processed"')
  })
})
