import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync('app/api/payments/create/route.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20261014120000_payments_gateway_at_create_v1.sql', 'utf8')

describe('public payment creation', () => {
  // gateway_runtime_invariants_guard rejects any gateway_transactions row without gateway_id.
  it('resolves the primary gateway before creating the transaction and creates it with that gateway', () => {
    expect(route.indexOf("from('funnel_gateway_bindings')")).toBeLessThan(route.indexOf("rpc('create_gateway_transaction'"))
    const createCall = route.split('\n').find(line => line.includes("rpc('create_gateway_transaction'")) ?? ''
    expect(createCall).toContain('p_gateway_id: selectedGatewayId')
  })

  it('stores the gateway on insert and keeps the function server-only', () => {
    expect(migration).toContain('p_gateway_id text DEFAULT NULL::text')
    expect(migration).toContain('p_user_id, p_organization_id, p_funnel_id, p_product_id, p_gateway_id, p_amount')
    expect(migration).toContain("g.id=p_gateway_id and g.organization_id=p_organization_id")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toMatch(/grant execute on function public\.create_gateway_transaction\([^)]*\) to service_role/)
  })
})
