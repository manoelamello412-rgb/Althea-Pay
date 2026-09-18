import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('Revenue OS Command Center', () => {
  it('keeps the operational aggregate tenant-scoped and authenticated-only', async () => {
    const source = await readFile('supabase/migrations/20260918182050_command_center_operations_v35.sql', 'utf8')

    expect(source).toContain('command_center_operations_v1')
    expect(source).toContain('private.is_org_member(v_org)')
    expect(source).toContain('organization_id=v_org')
    expect(source).toContain('from public,anon')
    expect(source).toContain('to authenticated')
  })

  it('bounds the operational window and recent command history', async () => {
    const source = await readFile('supabase/migrations/20260918182050_command_center_operations_v35.sql', 'utf8')

    expect(source).toContain('least(coalesce(p_hours,24),168)')
    expect(source).toContain('limit 5')
    expect(source).toContain("'recent_commands'")
  })

  it('consolidates real control-plane signals without client-side history scans', async () => {
    const component = await readFile('components/command-center-operations.tsx', 'utf8')

    expect(component).toContain("rpc('command_center_operations_v1'")
    expect(component).toContain('Atenção operacional')
    expect(component).toContain('Prontidão do Control Plane')
    expect(component).toContain('Últimos Commands')
    expect(component).toContain('href="/dashboard/recovery"')
    expect(component).toContain('href="/dashboard/routing"')
    expect(component).not.toContain(".from('gateway_transactions')")
    expect(component).not.toContain(".from('checkout_sessions')")
    expect(component).not.toContain(".from('integration_events')")
  })

  it('keeps realtime scoped by organization or current CRM user', async () => {
    const component = await readFile('components/command-center-operations.tsx', 'utf8')

    expect(component).toContain('organization_id=eq.')
    expect(component).toContain('user_id=eq.')
    expect(component).toContain("table: 'funnel_command_batches'")
    expect(component).toContain("table: 'funnel_control_drift_events'")
    expect(component).toContain("table: 'crm_conversations'")
  })

  it('embeds the command center in the existing production dashboard instead of replacing financial analytics', async () => {
    const dashboard = await readFile('components/dashboard-production.tsx', 'utf8')

    expect(dashboard).toContain("import { CommandCenterOperations } from '@/components/command-center-operations'")
    expect(dashboard).toContain('<CommandCenterOperations />')
    expect(dashboard).toContain("rpc('dashboard_production_data_for_user_secure'")
    expect(dashboard).toContain('Faturamento')
    expect(dashboard).toContain('Revenue Operating System')
  })

  it('derives attention only from persisted operational conditions', async () => {
    const source = await readFile('supabase/migrations/20260918182050_command_center_operations_v35.sql', 'utf8')

    expect(source).toContain("'command_failures'")
    expect(source).toContain("'connection_errors'")
    expect(source).toContain("'gateway_drift'")
    expect(source).toContain("'recovery_delivery'")
    expect(source).toContain("'crm_sla'")
    expect(source).toContain("'integration_errors'")
    expect(source).not.toContain('random()')
  })
})
