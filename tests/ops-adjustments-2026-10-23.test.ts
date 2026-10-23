import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attendantAllows } from '@/components/mobile-shell'

const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const bin = sql('20261023120000_transaction_test_delete_v1.sql')
const dashboard = sql('20261023121000_dashboard_realized_pending_v1.sql')
const attendant = sql('20261023122000_org_member_attendant_role_v1.sql')
const remarketing = sql('20261023123000_crm_remarketing_links_message_v1.sql')

describe('test payments go to the bin', () => {
  it('only owner/admin of the current org, and binned rows leave the list and the activity', () => {
    expect(bin).toContain("private.has_org_role(v_org, array['owner', 'admin'])")
    expect(bin).toContain('where id = p_transaction_id and organization_id = v_org and deleted_at is null')
    expect(bin.match(/t\.organization_id = v_org and t\.deleted_at is null/g)).toHaveLength(2)
  })
  it('the dashboard counts realized/pending from the ledger without binned rows', () => {
    expect(dashboard).toContain("where t.organization_id=p_org and t.deleted_at is null")
    expect(dashboard).toContain("status in ('created','pending')) pending_count")
    expect(dashboard.match(/bt\.deleted_at is not null/g)).toHaveLength(3)
  })
})

describe('attendant role', () => {
  it('gets chats and customers, never values or admin capabilities', () => {
    const line = (capability: string) => attendant.split('\n').find(row => row.includes(`when '${capability}'`)) ?? ''
    for (const allowed of ['can_view_chats', 'can_reply_chats', 'can_view_customers']) expect(line(allowed)).toContain("'attendant'")
    for (const denied of ['can_view_values', 'can_manage_members', 'can_manage_gateways', 'can_manage_automations', 'can_manage_funnels']) expect(line(denied)).not.toContain('attendant')
  })
  it('is refused by the payment and dashboard RPCs', () => {
    expect(`${bin}${dashboard}`.match(/has_org_role\(v_org, array\['attendant'\]\)/g)).toHaveLength(3)
  })
  it('only reaches customer service screens', () => {
    for (const path of ['/dashboard/crm', '/dashboard/clientes', '/dashboard/atendimento', '/dashboard/settings/perfil']) expect(attendantAllows(path)).toBe(true)
    for (const path of ['/dashboard', '/dashboard/pagamentos', '/dashboard/crm/campanhas', '/dashboard/settings', '/dashboard/members', '/dashboard/vendas']) expect(attendantAllows(path)).toBe(false)
  })
})

describe('remarketing', () => {
  it('checkout links are remarketing offers priced server side', () => {
    expect(remarketing).toContain("'remarketing',")
    expect(remarketing).toContain("private.crm_config_context('can_manage_automations')")
  })
  it('the campaign text wins over the template body; the approved template still goes when named', () => {
    expect(remarketing).toContain('coalesce(private.crm_render_named(k.message, v_ctx), private.crm_render_template(k.body, k.variables, v_ctx))')
    expect(remarketing).toContain("k.whatsapp_template_name is not null then jsonb_build_object('whatsapp_template'")
  })
})
