import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(request.url)
  const rawDays = Number(url.searchParams.get('days') ?? '30')
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, Math.trunc(rawDays))) : 30
  const { data, error } = await supabase.rpc('crm_revenue_intelligence', { p_days: days })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
