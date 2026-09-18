import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('Revenue OS NOC', () => {
  it('keeps NOC access authenticated and operator-role scoped', async () => {
    const source = await readFile('supabase/migrations/20260918183040_noc_operations_v36.sql', 'utf8')

    expect(source).toContain('noc_operations_v1')
    expect(source).toContain("private.has_org_role(v_org,array['owner','admin','manager','operator','supervisor'])")
    expect(source).toContain('from public,anon')
    expect(source).toContain('to authenticated')
  })

  it('bounds pg_cron inspection without modifying extension-owned tables', async () => {
    const source = await readFile('supabase/migrations/20260918183040_noc_operations_v36.sql', 'utf8')

    expect(source).toContain('limit 5000')
    expect(source).toContain('order by r.runid desc')
    expect(source).toContain("'cron_sample_limit',5000")
    expect(source).not.toContain('create index')
    expect(source).not.toContain('delete from cron.job_run_details')
    expect(source).not.toContain("'command',j.command")
  })

  it('keeps raw payloads, evidence and provider messages out of browser responses', async () => {
    const source = await readFile('supabase/migrations/20260918183040_noc_operations_v36.sql', 'utf8')

    expect(source).not.toContain("'payload'")
    expect(source).not.toContain("'evidence'")
    expect(source).not.toContain("'return_message'")
    expect(source).not.toContain("'error_message'")
    expect(source).not.toContain("'last_error'")
  })

  it('consolidates the operational failure domains and queue backlog', async () => {
    const source = await readFile('supabase/migrations/20260918183040_noc_operations_v36.sql', 'utf8')

    expect(source).toContain('cron_failures')
    expect(source).toContain('api_5xx')
    expect(source).toContain('integration_failures')
    expect(source).toContain('gateway_webhook_failures')
    expect(source).toContain('automation_failures')
    expect(source).toContain('crm_outbox_failures')
    expect(source).toContain('reconciliation_exceptions')
    expect(source).toContain('recovery_failures')
    expect(source).toContain('command_failures')
    expect(source).toContain("'queues'")
    expect(source).toContain("'cron_jobs'")
    expect(source).toContain("'readiness'")
    expect(source).toContain("'incidents'")
  })

  it('does not point automation incidents at a nonexistent route', async () => {
    const source = await readFile('supabase/migrations/20260918183249_noc_automation_route_alignment_v37.sql', 'utf8')

    expect(source).toContain("'automation'")
    expect(source).toContain("'/dashboard/crm'")
    expect(source).not.toContain('/dashboard/automacoes')
  })

  it('uses one canonical NOC page and redirects the old CRM observability page', async () => {
    const page = await readFile('app/dashboard/noc/page.tsx', 'utf8')
    const legacy = await readFile('app/dashboard/crm/observability/page.tsx', 'utf8')
    const navigation = await readFile('components/mobile-shell.tsx', 'utf8')

    expect(page).toContain("rpc('noc_operations_v1'")
    expect(page).toContain('NOC / Observabilidade')
    expect(page).toContain('Production readiness')
    expect(page).toContain('Schedulers')
    expect(page).toContain('Incidentes recentes')
    expect(legacy).toContain("redirect('/dashboard/noc')")
    expect(navigation).toContain("href: '/dashboard/noc'")
  })

  it('does not scan operational log tables directly from the browser', async () => {
    const page = await readFile('app/dashboard/noc/page.tsx', 'utf8')

    expect(page).not.toContain(".from('api_request_logs')")
    expect(page).not.toContain(".from('gateway_webhook_events')")
    expect(page).not.toContain(".from('automation_executions')")
    expect(page).not.toContain(".from('cron.job_run_details')")
  })
})
