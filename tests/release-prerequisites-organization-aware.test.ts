import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260920045506_server_writer_minimum_privileges.sql',
  'utf8',
).toLowerCase()
const gateway = readFileSync(
  'supabase/functions/gateway-webhook-processor/index.ts',
  'utf8',
)

describe('organization-aware release prerequisites', () => {
  it('grants only column-scoped server writer privileges', () => {
    expect(migration).toContain('grant insert (')
    expect(migration).toContain('on public.integration_events to service_role')
    expect(migration).toContain('on public.sales to service_role')
    expect(migration).toContain('grant update (')
    expect(migration).not.toContain('grant all')
    expect(migration).not.toContain('grant insert on public.integration_events')
    expect(migration).not.toContain('grant insert on public.sales')
    expect(migration).not.toContain('grant update on public.sales')
  })

  it('keeps immutable sale identity columns outside update privileges', () => {
    const updateSection = migration.slice(
      migration.indexOf('-- existing writers update only persisted sale business fields'),
      migration.indexOf('-- dormant legacy projectors'),
    )
    expect(updateSection).not.toMatch(/\bid\s*,/)
    expect(updateSection.replace(/--[^\n]*/g, '')).not.toContain('created_at')
    expect(migration).toContain("has_column_privilege('service_role','public.sales','id','update')")
    expect(migration).toContain("has_column_privilege('service_role','public.sales','created_at','update')")
  })

  it('revokes runtime service-role access to dormant legacy sale projectors', () => {
    expect(migration).toContain(
      'revoke execute on function public.project_funnel_event(uuid) from service_role',
    )
    expect(migration).toContain(
      'revoke execute on function public.project_checkout_purchase(uuid) from service_role',
    )
  })

  it('authenticates gateway webhook automation dispatch with the verified internal secret', () => {
    expect(gateway).toContain('"x-internal-secret": internalSecret')
    expect(gateway).toContain('processOne(event, suppliedSecret)')
  })

  it('derives automation tenant context from the canonical transaction', () => {
    expect(gateway).toContain(
      'select("id,user_id,organization_id,funnel_id,external_id").eq("id", String(data.transaction_id)).maybeSingle()',
    )
    expect(gateway).toContain('user_id: tx.data.user_id')
    expect(gateway).toContain('organization_id: tx.data.organization_id')
    expect(gateway).toContain('transaction_id: tx.data.id')
  })

  it('does not alias gateway_webhook_events.id into integration_events event_id', () => {
    expect(gateway).not.toContain('event_id: webhookId')
  })

  it('keeps automation failure best-effort so webhook retry semantics are unchanged', () => {
    expect(gateway).toContain('console.error("automation_dispatch_failed"')
    expect(gateway).toContain('automation_transaction_lookup_failed')
    expect(gateway).toContain('return object(data) ? { ok: true, ...data } : { ok: true, data }')
  })
})
