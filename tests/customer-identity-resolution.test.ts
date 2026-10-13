import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('canonical customer identity resolution', () => {
  const migration = readFileSync(
    'supabase/migrations/20261013120000_customer_identity_resolution_v1.sql',
    'utf8',
  )

  it('keeps clients as the anchor and stores identities separately', () => {
    expect(migration).toContain('create table if not exists public.customer_identities')
    expect(migration).toContain("kind in ('email','phone','visitor_id')")
    expect(migration).toContain('references public.clients(user_id,id) on delete cascade')
    expect(migration).toContain('unique (organization_id,user_id,kind,value)')
  })

  it('never auto-merges: conflicting identities become merge candidates', () => {
    expect(migration).toContain('insert into public.customer_merge_candidates')
    expect(migration).toContain("when 'email' then 0 when 'phone' then 1 else 2 end")
    expect(migration).not.toMatch(/delete\s+from\s+public\.clients/i)
  })

  it('does not create customers from an anonymous visitor_id', () => {
    expect(migration).toContain("i->>'kind' in ('email','phone')")
  })

  it('routes every customer writer through the single resolver', () => {
    for (const fn of [
      'public.materialize_gateway_customer_identity',
      'public.materialize_funnel_chat_event',
      'public.crm_ingest_channel_message',
    ]) {
      expect(migration).toContain(`function ${fn}(`)
    }
    expect(migration.match(/private\.resolve_customer\(/g)?.length).toBeGreaterThanOrEqual(4)
    expect(migration).not.toMatch(/lower\(coalesce\(cl\.data->>'email'/)
  })

  it('exposes identities read-only to organization members', () => {
    expect(migration).toContain('using (private.is_org_member(organization_id))')
    expect(migration).toContain('revoke all on function private.resolve_customer')
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/i)
  })
})
