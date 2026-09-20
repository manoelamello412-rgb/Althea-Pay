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

  it('uses internal transaction identity as the primary sale identity', () => {
    expect(source).toContain(
      'db.from("sales").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("transaction_id", tx.id).maybeSingle()',
    )
    expect(source).toContain('id: `gateway_tx_${String(tx.id)}`')
    expect(source).not.toContain('id: `sale_${organizationId}_${String(event.external_id ?? event.id)}`')
  })

  it('writes organization_id explicitly on every materialized sale', () => {
    expect(source).toContain('user_id: userId, organization_id: organizationId')
  })

  it('does not treat an unrelated 23505 as a successful duplicate sale', () => {
    expect(source).toContain('if (sale.error.code === "23505")')
    expect(source).toContain(
      'db.from("sales").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("transaction_id", tx.id).maybeSingle()',
    )
    expect(source).toContain('if (!concurrent.data) throw sale.error')
  })

  it('prefers transaction identity for reversal and uses external id only as a guarded fallback', () => {
    const txLookup = source.indexOf(
      'db.from("sales").select("id,transaction_id").eq("organization_id", organizationId).eq("user_id", userId).eq("transaction_id", tx.id).maybeSingle()',
    )
    const fallback = source.indexOf(
      'db.from("sales").select("id,transaction_id").eq("organization_id", organizationId).eq("user_id", userId).eq("external_id", externalId).limit(2)',
    )
    expect(txLookup).toBeGreaterThan(-1)
    expect(fallback).toBeGreaterThan(txLookup)
    expect(source).toContain('sale_external_id_ambiguous')
    expect(source).toContain('sale_external_id_conflict')
  })

  it('updates only the resolved sale inside the organization', () => {
    expect(source).toContain(
      'db.from("sales").update({ status, data: payload }).eq("id", targetSale.id).eq("organization_id", organizationId).eq("user_id", userId)',
    )
  })

  it('passes canonical sale_id downstream to the automation engine', () => {
    expect(source).toContain('sale_id: saleId')
  })

  it('preserves event claim/retry and already-processed idempotency behavior', () => {
    expect(source).toContain('db.rpc("claim_integration_event", { p_event_id: eventId })')
    expect(source).toContain('already_processed: true')
    expect(source).toContain('p_status: "processed"')
    expect(source).toContain('p_status: "retry"')
  })
})
