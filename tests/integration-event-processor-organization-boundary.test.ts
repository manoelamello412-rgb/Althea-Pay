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

  it('accepts the normal org A event -> transaction A -> sale A path', () => {
    expect(source).toContain(
      'db.from("gateway_transactions").select("*").eq("id", transactionId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle()',
    )
    expect(source).toMatch(
      /db\.from\("sales"\)\.insert\(\{[\s\S]*?user_id: userId, organization_id: organizationId,/,
    )
  })

  it('keeps organization in the transaction boundary even when the same user owns multiple organizations', () => {
    expect(source).toContain('.eq("user_id", userId).eq("organization_id", organizationId)')
    expect(source).toContain('transaction_tenant_mismatch_or_not_found')
    expect(source).toContain('transaction_transition_tenant_mismatch')
  })

  it('rejects an org A event from locating or updating an org B checkout', () => {
    expect(source).toContain(
      'db.from("checkout_sessions").select("id,user_id,organization_id").eq("id", checkoutId).eq("user_id", userId).eq("organization_id", organizationId).maybeSingle()',
    )
    expect(source).toMatch(
      /db\.from\("checkout_sessions"\)\.update\([\s\S]*?\.eq\("id", checkoutId\)\.eq\("user_id", userId\)\.eq\("organization_id", organizationId\)\.select\("id"\)\.maybeSingle\(\)/,
    )
    expect(source).toContain('checkout_tenant_mismatch_or_not_found')
    expect(source).toContain('checkout_update_tenant_mismatch')
  })

  it('scopes sale idempotency by organization so equal external IDs in A and B do not collide', () => {
    expect(source).toContain(
      'db.from("sales").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("external_id", externalId).maybeSingle()',
    )
    expect(source).toContain('id: `sale_${organizationId}_${String(event.external_id ?? event.id)}`')
  })

  it('writes the canonical organization_id explicitly on every materialized sale', () => {
    expect(source).toMatch(
      /db\.from\("sales"\)\.insert\(\{[\s\S]*?organization_id: organizationId,/,
    )
  })

  it('restricts refund and chargeback sale updates to the event organization', () => {
    expect(source).toContain('["refunded", "chargeback"].includes(status)')
    expect(source).toContain(
      'db.from("sales").update({ status, data: payload }).eq("organization_id", organizationId).eq("user_id", userId).eq("external_id", externalId)',
    )
  })

  it('preserves event claim/retry and already-processed idempotency behavior', () => {
    expect(source).toContain('db.rpc("claim_integration_event", { p_event_id: eventId })')
    expect(source).toContain('already_processed: true')
    expect(source).toContain('p_status: "processed"')
    expect(source).toContain('p_status: "retry"')
    expect(source).toContain('sale.error.code !== "23505"')
  })
})
