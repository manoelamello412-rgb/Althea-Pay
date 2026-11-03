import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Real round trip to Postgres (a HEAD select under RLS), so latency_ms measures the database, not the client setup.
export async function GET() {
  const startedAt = Date.now()
  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.from('profiles').select('id', { head: true }).limit(1)
    const latency = Date.now() - startedAt
    if (error) throw error
    return NextResponse.json({ ok: true, provider: 'supabase', status: 'reachable', latency_ms: latency }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { ok: false, provider: 'supabase', status: 'unreachable', latency_ms: Date.now() - startedAt },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
