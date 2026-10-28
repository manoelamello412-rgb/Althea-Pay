import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260920041520_organization_aware_identity_indexes.sql'
const migration = readFileSync(migrationPath, 'utf8')
const normalized = migration.toLowerCase()

describe('organization-aware identity migration', () => {
  it('creates the two reviewed organization-aware lookup indexes', () => {
    expect(normalized).toContain('create index if not exists sales_org_external_gateway_idx')
    expect(normalized).toContain('on public.sales (organization_id, external_id, gateway_id)')
    expect(normalized).toContain('create index if not exists integration_events_org_funnel_external_idx')
    expect(normalized).toContain('on public.integration_events (organization_id, funnel_id, external_id)')
    expect(normalized.match(/where external_id is not null/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('removes only the two reviewed legacy unique indexes', () => {
    const drops = normalized.match(/drop index\s+public\.[a-z0-9_]+\s*;/g) ?? []
    expect(drops).toEqual([
      'drop index public.sales_user_external_unique;',
      'drop index public.integration_events_user_external_unique;',
    ])
    expect(normalized).not.toContain('drop constraint')
  })

  it('preserves event-key, transaction idempotency, and primary keys', () => {
    expect(normalized).toContain('integration_events_event_key_uidx')
    expect(normalized).toContain('sales_user_transaction_unique')
    expect(normalized).toContain('sales_pkey')
    expect(normalized).toContain('integration_events_pkey')
    expect(normalized).not.toContain('drop index public.integration_events_event_key_uidx')
    expect(normalized).not.toContain('drop index public.sales_user_transaction_unique')
    expect(normalized).not.toContain('drop index public.sales_pkey')
    expect(normalized).not.toContain('drop index public.integration_events_pkey')
  })

  it('aborts if legacy or preserved index definitions drift', () => {
    expect(normalized).toContain('unexpected sales_user_external_unique definition')
    expect(normalized).toContain('unexpected integration_events_user_external_unique definition')
    expect(normalized).toContain('unexpected integration_events_event_key_uidx definition')
    expect(normalized).toContain('unexpected sales_user_transaction_unique definition')
    expect(normalized).toContain('unexpected sales_pkey definition')
    expect(normalized).toContain('unexpected integration_events_pkey definition')
  })

  it('refuses unsafe integration events instead of inventing a backfill', () => {
    expect(normalized).toContain('where external_id is not null and event_key is null')
    expect(normalized).toContain('no automatic backfill is permitted')
    expect(normalized).not.toContain('update public.integration_events set event_key')
  })

  it('keeps register_integration_event compatible with on conflict(event_key)', () => {
    expect(normalized).toContain("to_regprocedure('public.register_integration_event(text,text,text,jsonb,timestamp with time zone)')")
    expect(normalized).toContain("on conflict (event_key) where event_key is not null")
    expect(normalized).toContain('integration_events_event_key_uidx')
  })

  it('contains no unrelated destructive sales or integration-events schema changes', () => {
    expect(normalized).not.toMatch(/drop\s+table/)
    expect(normalized).not.toMatch(/truncate\s+(table\s+)?public\.(sales|integration_events)/)
    expect(normalized).not.toMatch(/alter\s+table\s+public\.(sales|integration_events)\s+drop/)
  })
})
