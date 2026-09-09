import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const parsed = Number(searchParams.get('days') ?? '7')
  const days = Number.isFinite(parsed) ? Math.max(1, Math.min(30, Math.floor(parsed))) : 7
  const { data, error } = await supabase.rpc('crm_recovery_opportunities', { p_days: days })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ days, opportunities: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }
  const eventId = typeof body === 'object' && body !== null && 'event_id' in body
    ? (body as { event_id?: unknown }).event_id
    : null
  if (typeof eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'INVALID_EVENT_ID' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('crm_recovery_execute', { p_event_id: eventId })
  if (error) {
    const status = error.message === 'event_not_found' ? 404 : error.message === 'unauthorized' ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json(data)
}
