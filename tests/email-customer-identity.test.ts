import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261014160000_email_is_customer_identity_v1.sql', 'utf8')

describe('email is the customer identity', () => {
  it('never attaches a new email to a customer matched only by phone or visitor_id', () => {
    expect(migration).toContain('select ci.client_id, ci.kind into v_client, v_kind')
    expect(migration).toContain("if v_kind <> 'email' and private.normalize_customer_identity('email',p_email) is not null")
    expect(migration).toContain('v_client := null;')
  })

  it('anonymous funnel events never open a conversation per event', () => {
    const guard = migration.indexOf('if v_email is null and v_phone is null and v_customer_id is null then')
    // The guard must sit in the non-chat branch, right before the insert.
    expect(guard).toBeGreaterThan(migration.indexOf('  else\n    select id into v_conversation'))
    expect(guard).toBeLessThan(migration.indexOf('insert into public.crm_conversations('))
  })
})
