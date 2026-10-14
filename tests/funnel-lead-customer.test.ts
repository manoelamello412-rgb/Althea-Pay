import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261014130000_funnel_lead_customer_v1.sql', 'utf8')

describe('funnel leads become customers', () => {
  it('resolves the customer from any funnel event carrying email or phone, without losing the event', () => {
    expect(migration).toContain('after insert on public.integration_events')
    expect(migration).toContain("v_client := private.resolve_customer(")
    expect(migration).toContain("(v_email is null and v_phone is null)")
    expect(migration).toContain("raise warning 'funnel_lead_customer_failed")
    expect(migration).toContain('revoke all on function private.materialize_funnel_lead_customer() from public, anon, authenticated;')
  })

  it('opens the customer conversation inside the funnel and never gives one customer two open conversations there', () => {
    // crm_mirror_client_event reads data.funnel_id; without it the new customer got a funnel-less duplicate conversation.
    expect(migration).toContain("'funnel_id',new.funnel_id)));")
    expect(migration).not.toContain('source_funnel_id')
    expect(migration.match(/x\.customer_id=(v_client|c\.client_id)/g)).toHaveLength(2)
  })

  it('chat falls back to the email when the resolved customer has no conversation yet', () => {
    expect(migration).toContain('if conv is null and normalized_email is not null then')
    expect(migration).not.toContain('canonical_customer_id is null and normalized_email is not null')
  })
})
