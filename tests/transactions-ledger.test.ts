import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261014100000_transactions_ledger_v1.sql', 'utf8')
const page = readFileSync('app/dashboard/pagamentos/page.tsx', 'utf8')
const fn = (name: string) => { const start = migration.indexOf(`function public.${name}(`); return migration.slice(start, migration.indexOf('$function$;', start)) }

describe('transactions ledger contract', () => {
  it('pages on the server with a keyset cursor, scoped to the current organization', () => {
    const body = fn('transactions_list_v1')
    expect(body).toContain('private.current_organization_id()')
    expect(body).toContain('private.is_org_member(v_org)')
    expect(body).toContain('(t.created_at, t.id) < (p_before_created_at, p_before_id)')
    expect(body).toContain("least(greatest(coalesce(p_limit, 50), 1), 200)")
    expect(body).toContain("'INVALID_CURSOR'")
    expect(body).toContain("'amount', case when v_values then t.amount end")
    expect(migration).toContain('gateway_transactions_org_created_idx on public.gateway_transactions(organization_id, created_at desc, id desc)')
  })

  it('builds the history from audit events, gateway attempts and webhooks of the same organization', () => {
    const body = fn('transaction_detail_v1')
    expect(body).toContain('from public.transaction_audit_events a')
    expect(body).toContain('from public.gateway_payment_attempts pa')
    expect(body).toContain('from public.gateway_webhook_events w')
    expect(body).toContain("where id = p_transaction_id and organization_id = v_org")
    // crm_conversations.transaction_id is text in production; comparing it to the uuid fails at runtime.
    expect(body).not.toMatch(/[^.]transaction_id = v_tx\.id(?!::text)\b/)
    expect(body).toContain("v_receipts := v_values and private.has_org_capability(v_org, 'can_view_chats')")
  })

  it('links receipts only through an audited RPC that checks both sides belong to the organization', () => {
    const body = fn('crm_receipt_link_transaction')
    expect(body).toContain("has_org_capability(v_org, 'can_reply_chats') and private.has_org_capability(v_org, 'can_view_values')")
    expect(body).toContain('c.organization_id = v_org')
    expect(body).toContain("where id = p_transaction_id and organization_id = v_org")
    expect(body).toContain("'crm.receipt.linked'")
    for (const name of ['transactions_list_v1', 'transaction_detail_v1', 'crm_receipt_link_transaction']) {
      expect(migration, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`))
    }
  })

  it('the payments page reads the RPCs instead of downloading the table', () => {
    expect(page).toContain("db.rpc('transactions_list_v1'")
    expect(page).toContain("db.rpc('transaction_detail_v1', { p_transaction_id: id })")
    expect(page).toContain("db.rpc('crm_receipt_link_transaction'")
    expect(page).not.toContain(".from('gateway_transactions')")
    expect(page).not.toContain('.limit(5000)')
  })
})
