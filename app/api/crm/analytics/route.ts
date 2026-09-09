import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  try {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const rawDays = Number(new URL(request.url).searchParams.get('days') ?? 30)
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, Math.trunc(rawDays))) : 30

    const { data, error } = await supabase.rpc('crm_analytics', { p_days: days })
    if (error) {
      console.error('[ALTHEA CRM ANALYTICS]', error)
      return NextResponse.json({ error: 'analytics_query_failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, ...(data as Record<string, unknown>), timestamp: new Date().toISOString() })
  } catch (error) {
    console.error('[ALTHEA CRM ANALYTICS]', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
