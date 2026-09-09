import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()

  try {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
    if (typeof body !== 'object' || body === null || !('event_id' in body)) {
      return NextResponse.json({ error: 'event_id_required' }, { status: 400 })
    }

    const eventId = String((body as { event_id: unknown }).event_id)
    if (!/^[0-9a-fA-F-]{36}$/.test(eventId)) return NextResponse.json({ error: 'invalid_event_id' }, { status: 400 })

    const { data, error } = await supabase.rpc('crm_recovery_execute', { p_event_id: eventId })
    if (error) {
      if (error.message.includes('event_not_found')) return NextResponse.json({ error: 'event_not_found' }, { status: 404 })
      if (error.message.includes('unauthorized')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      console.error('[ALTHEA CRM RECOVERY]', error)
      return NextResponse.json({ error: 'recovery_execution_failed' }, { status: 500 })
    }

    return NextResponse.json(data ?? { success: true }, { status: 200 })
  } catch (error) {
    console.error('[ALTHEA CRM RECOVERY]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
