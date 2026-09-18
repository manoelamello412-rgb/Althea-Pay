import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('journey session state', () => {
  it('evolves attribution sessions instead of creating a parallel session authority', async () => {
    const source = await readFile('supabase/migrations/20260918170057_journey_session_state_v22.sql', 'utf8')
    expect(source).toContain('alter table public.attribution_sessions')
    expect(source).toContain('current_event_type text')
    expect(source).toContain('visitor_id text')
    expect(source).toContain('customer_id text')
    expect(source).toContain("session_state='active'")
    expect(source).toContain('public.v_funnel_live_journeys')
    expect(source).toContain('grant execute on function public.project_attribution_event(uuid,text,text,text,jsonb) to service_role')
  })

  it('exposes a live operator screen backed by the canonical view', async () => {
    const source = await readFile('app/dashboard/funil/live/page.tsx', 'utf8')
    expect(source).toContain("from('v_funnel_live_journeys')")
    expect(source).toContain("from('integration_events')")
    expect(source).toContain(".eq('session_id', journey.session_key)")
    expect(source).toContain('Visitante anônimo')
  })
})
