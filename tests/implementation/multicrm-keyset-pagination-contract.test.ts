import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260911070000_crm_multicrm_keyset_pagination_v1.sql'),
  'utf8',
).toLowerCase()

describe('Multi-CRM canonical keyset pagination contract', () => {
  it('defines one canonical conversations cursor ordered by updated_at and id', () => {
    expect(migration).toContain('crm_multicrm_conversations_page')
    expect(migration).toContain('order by c.updated_at desc, c.id desc')
    expect(migration).toContain('c.updated_at < p_cursor_updated_at')
    expect(migration).toContain('(c.updated_at = p_cursor_updated_at and c.id < p_cursor_id)')
    expect(migration).not.toMatch(/\boffset\b/)
  })

  it('keeps tenant isolation and inbox filter dimensions', () => {
    expect(migration).toContain('c.user_id = auth.uid()')
    expect(migration).toContain("p_filter = 'unread'")
    expect(migration).toContain("p_filter in ('open','pending','closed')")
    expect(migration).toContain('p_agent_id is null or c.assigned_to = p_agent_id')
    expect(migration).toContain("c.metadata->>'team_id' = p_team_id::text")
    expect(migration).toContain('p_priority is null or c.priority = p_priority')
  })

  it('searches canonical conversation identity fields and message bodies', () => {
    expect(migration).toContain('c.buyer_name ilike')
    expect(migration).toContain('c.buyer_email ilike')
    expect(migration).toContain('c.customer_whatsapp ilike')
    expect(migration).toContain('from public.crm_messages m')
    expect(migration).toContain('m.body ilike')
  })

  it('defines incremental message pagination with a deterministic tie-breaker', () => {
    expect(migration).toContain('crm_multicrm_messages_page')
    expect(migration).toContain('m.created_at < p_cursor_created_at')
    expect(migration).toContain('(m.created_at = p_cursor_created_at and m.id < p_cursor_id)')
    expect(migration).toContain('order by m.created_at desc, m.id desc')
  })

  it('exposes only authenticated execution', () => {
    expect(migration).toContain('revoke all on function public.crm_multicrm_conversations_page')
    expect(migration).toContain('grant execute on function public.crm_multicrm_conversations_page')
    expect(migration).toContain('revoke all on function public.crm_multicrm_messages_page')
    expect(migration).toContain('grant execute on function public.crm_multicrm_messages_page')
  })
})
