import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('CRM assignment concurrency contract', () => {
  it('serializes assignment mutations and makes null team/agent an explicit clear', () => {
    const root = resolve(process.cwd())
    const migration = readFileSync(resolve(root, 'supabase/migrations/20260911000000_crm_assignment_concurrency_and_unassignment_v2.sql'), 'utf8')

    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0))')
    expect(migration).toContain('assigned_to=p_agent_id')
    expect(migration).toContain("coalesce(metadata,'{}'::jsonb) - 'team_id'")
    expect(migration).toContain("grant execute on function public.crm_assign_conversation(uuid,uuid,uuid,text) to authenticated")
    expect(migration).toContain("revoke all on function public.crm_assign_conversation(uuid,uuid,uuid,text) from public,anon")
  })
})
