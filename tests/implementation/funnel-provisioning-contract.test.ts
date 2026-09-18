import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const routePath = 'app/api/funnels/provision/route.ts'
const migrationPath = 'supabase/migrations/20260918165242_allow_funnel_provision_without_product_gateway.sql'

describe('funnel provisioning contract', () => {
  it('allows external funnel registration before product and gateway binding', async () => {
    const source = await readFile(routePath, 'utf8')
    expect(source).toContain('const productId = optionalId(body?.product_id)')
    expect(source).toContain('const gatewayId = optionalId(body?.gateway_id)')
    expect(source).not.toContain("if (!productId) return json({ error: 'product_required' }")
    expect(source).not.toContain("if (!gatewayId) return json({ error: 'gateway_required' }")
    expect(source).toContain('p_product_id: productId')
    expect(source).toContain('p_gateway_id: gatewayId')
  })

  it('keeps optional commercial resources tenant-validated when supplied', async () => {
    const source = await readFile(migrationPath, 'utf8')
    expect(source).toContain("if nullif(btrim(coalesce(p_product_id,'')),'') is not null then")
    expect(source).toContain("if nullif(btrim(coalesce(p_gateway_id,'')),'') is not null then")
    expect(source).toContain("message='product_organization_mismatch'")
    expect(source).toContain("message='gateway_organization_mismatch'")
  })

  it('creates offer and gateway binding only when each resource exists', async () => {
    const source = await readFile(migrationPath, 'utf8')
    expect(source).toContain('if v_product.id is not null then')
    expect(source).toContain('if v_gateway.id is not null then')
    expect(source).toContain("'product',v_offer")
    expect(source).toContain("'gateway',v_binding")
  })
})
