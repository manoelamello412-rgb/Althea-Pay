import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261022120000_checkout_customer_document_v1.sql', 'utf8')
const page = readFileSync('app/dashboard/clientes/page.tsx', 'utf8')

describe('CPF do comprador no cliente', () => {
  it('checkout grava nome e CPF (só dígitos) no cliente sem derrubar o checkout', () => {
    expect(migration).toContain('perform private.resolve_customer(')
    expect(migration).toContain("'document',nullif(regexp_replace(coalesce(v_customer->>'document',v_customer->>'cpf',''),'[^0-9]+','','g'),'')")
    expect(migration).toContain("raise warning 'CHECKOUT_CUSTOMER_PROJECTION_FAILED: %', sqlerrm;")
  })

  it('mantém o RPC só para o servidor', () => {
    expect(migration).toContain('from public, anon, authenticated;')
    expect(migration).toContain('to service_role;')
  })

  it('tela de clientes mostra e busca CPF', () => {
    expect(page).toContain("const documentOf = (client: Client) => pick(obj(client.data), ['document', 'cpf', 'tax_id'])")
    expect(page).toContain('<span>CPF</span>')
    expect(page).toContain("cpf(pick(data, ['document', 'cpf', 'tax_id']))")
  })
})
