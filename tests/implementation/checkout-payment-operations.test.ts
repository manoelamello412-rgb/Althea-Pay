import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('checkout and payment operations', () => {
  it('versions the server-side keyset pagination and tenant-aware RPCs', async () => {
    const source = await readFile('supabase/migrations/20260918171635_checkout_payment_operations_v24.sql', 'utf8')

    expect(source).toContain('checkout_operations_page_v1')
    expect(source).toContain('checkout_operations_detail_v1')
    expect(source).toContain('payment_operations_page_v1')
    expect(source).toContain('payment_operations_detail_v1')
    expect(source).toContain('(c.created_at,c.id)<(p_cursor_created_at,p_cursor_id)')
    expect(source).toContain('(t.created_at,t.id)<(p_cursor_created_at,p_cursor_id)')
    expect(source).toContain('private.is_org_member(v_org)')
    expect(source).toContain('limit v_limit+1')
  })

  it('links financial webhooks to tenant and transaction context without exposing raw payloads in detail', async () => {
    const source = await readFile('supabase/migrations/20260918171635_checkout_payment_operations_v24.sql', 'utf8')

    expect(source).toContain('add column if not exists organization_id uuid')
    expect(source).toContain('add column if not exists transaction_id uuid')
    expect(source).toContain('link_gateway_webhook_event_context')
    expect(source).toContain("to_jsonb(w)-'payload'")
    expect(source).toContain('gateway_webhook_events_transaction_received_idx')
  })

  it('uses paginated Checkout 360 instead of fixed client-side history batches', async () => {
    const source = await readFile('app/dashboard/checkouts/page.tsx', 'utf8')

    expect(source).toContain("rpc('checkout_operations_page_v1'")
    expect(source).toContain("rpc('checkout_operations_detail_v1'")
    expect(source).toContain('Carregar mais 50')
    expect(source).not.toContain(".limit(200)")
    expect(source).not.toContain("from('checkout_sessions')")
  })

  it('uses paginated Payment 360 instead of loading 5000 transactions in the browser', async () => {
    const source = await readFile('app/dashboard/pagamentos/page.tsx', 'utf8')

    expect(source).toContain("rpc('payment_operations_page_v1'")
    expect(source).toContain("rpc('payment_operations_detail_v1'")
    expect(source).toContain('Tentativas e roteamento')
    expect(source).toContain('Conciliação')
    expect(source).toContain('Journals financeiros')
    expect(source).not.toContain('.limit(5000)')
    expect(source).not.toContain("from('gateway_transactions')")
  })

  it('keeps RPC execution authenticated-only', async () => {
    const source = await readFile('supabase/migrations/20260918171635_checkout_payment_operations_v24.sql', 'utf8')

    expect(source).toContain('to authenticated')
    expect(source).toContain('from public,anon')
  })
})
