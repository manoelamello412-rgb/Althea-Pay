import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasOrganizationCapability, parseOrganizationAccess } from '../lib/auth/organization-access'

describe('frontend organization access contract', () => {
  it('parses effective capabilities conservatively', () => {
    const access = parseOrganizationAccess({
      organization_id: 'org-1',
      user_id: 'user-1',
      role: 'operator',
      capabilities: {
        can_view_chats: true,
        can_reply_chats: true,
        can_view_values: false,
      },
      operational_history_hours: 48,
      retention_policy: 'separate_from_visibility',
    })

    expect(access?.organization_id).toBe('org-1')
    expect(hasOrganizationCapability(access, 'can_view_chats')).toBe(true)
    expect(hasOrganizationCapability(access, 'can_reply_chats')).toBe(true)
    expect(hasOrganizationCapability(access, 'can_view_values')).toBe(false)
    expect(hasOrganizationCapability(access, 'can_manage_gateways')).toBe(false)
  })

  it('loads CRM workspace through the effective access RPC and organization scope', () => {
    const source = readFileSync('app/dashboard/crm/page.tsx', 'utf8')

    expect(source).toContain("rpc('organization_my_access_v1'")
    expect(source).toContain("eq('organization_id',org)")
    expect(source).toContain("filter:`organization_id=eq.${organizationId}`")
    expect(source).not.toContain("from('funnels').select('id,nome').eq('user_id'")
    expect(source).not.toContain("from('products').select('id,name,data')")
    expect(source).not.toContain("from('crm_conversations').select('*').eq('user_id'")
  })

  it('enforces reply capability in mutations and controls', () => {
    const source = readFileSync('app/dashboard/crm/page.tsx', 'utf8')

    expect(source).toContain("!canReplyChats")
    expect(source).toContain("placeholder={!canReplyChats?'Seu acesso é somente leitura'")
    expect(source).toContain("disabled={assigning||!canReplyChats}")
    expect(source).toContain("disabled={!draft.trim()||sending||selected.status==='closed'||!canReplyChats}")
  })

  it('keeps non-owner CRM synchronized without reopening direct table reads', () => {
    const source = readFileSync('app/dashboard/crm/page.tsx', 'utf8')

    expect(source).toContain("access?.role==='owner'?undefined:window.setInterval(refresh,5000)")
    expect(source).toContain("rpc('crm_multicrm_conversations_page'")
    expect(source).toContain("rpc('crm_multicrm_messages_page'")
  })

  it('limits financial/customer event fields before they reach the UI', () => {
    const source = readFileSync('app/dashboard/crm/page.tsx', 'utf8')

    expect(source).toContain("canViewCustomers")
    expect(source).toContain("'id,transaction_id,status,error_reason,received_at'")
    expect(source).toContain("if (!c.transaction_id || !organizationId || !canViewValues)")
  })

  it('scopes org-RLS tables by the current organization instead of the owner user_id', () => {
    const orgScopedTables = ['funnels', 'funnel_connections', 'clients', 'sales', 'gateway_transactions', 'checkout_sessions', 'integration_events', 'webhook_integrations', 'automation_executions', 'api_keys', 'api_request_logs', 'outbound_webhooks', 'outbound_webhook_deliveries', 'transaction_routing_logs', 'crm_channel_delivery_events']
    for (const file of [
      'app/dashboard/funil/page.tsx',
      'app/dashboard/funil/central/page.tsx',
      'app/dashboard/api/page.tsx',
      'app/dashboard/clientes/page.tsx',
      'app/dashboard/webhooks/page.tsx',
      'components/sales-mobile.tsx',
      'app/api/crm/observability/route.ts',
      'app/dashboard/pagamentos/page.tsx',
      'app/dashboard/settings/desempenho/page.tsx',
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toContain('loadOrganizationAccess(')
      for (const table of orgScopedTables) {
        expect(source, `${file} ${table}`).not.toMatch(new RegExp(`from\\(['"]${table}['"]\\)[^\\n]*eq\\(['"]user_id['"]`))
      }
      expect(source, `${file} realtime`).not.toContain('filter: `user_id=eq.')
    }
  })
})
