import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8')

describe('Multi-CRM inbox operational contracts',()=>{
  it('wires canonical assignment, team selection and Customer 360 from the live inbox',()=>{
    const page=read('app/dashboard/crm/page.tsx')
    expect(page).toContain("supabase.rpc('crm_assign_conversation'")
    expect(page).toContain("supabase.from('crm_agents')")
    expect(page).toContain("supabase.from('crm_teams')")
    expect(page).toContain('/dashboard/crm/customer-360?conversation=')
    expect(page).toContain("supabase.rpc('crm_customer_360'")
  })

  it('preserves explicit unassignment and concurrency semantics in the canonical RPC migration',()=>{
    const migration=read('supabase/migrations/20260911190000_crm_assignment_concurrency_unassignment_sync_v1.sql')
    expect(migration).toContain('set assigned_to=p_agent_id')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain("when p_team_id is null then coalesce(metadata,'{}'::jsonb) - 'team_id'")
    expect(migration).toContain("'CONVERSATION_NOT_FOUND'")
    expect(migration).toContain("'AGENT_NOT_FOUND'")
    expect(migration).toContain("'TEAM_NOT_FOUND'")
  })

  it('keeps team reads tenant-scoped through RLS while granting the required table privilege',()=>{
    const migration=read('supabase/migrations/20260911152500_crm_team_select_grant_v1.sql')
    const page=read('app/dashboard/crm/page.tsx')
    expect(migration).toContain('grant select on table public.crm_teams to authenticated')
    expect(page).toContain(".eq('user_id',id)")
    expect(page).toContain(".eq('active',true)")
  })
})
