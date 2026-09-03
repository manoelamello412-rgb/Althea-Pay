import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()

  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.from('platform_health_checks').select('check_name').limit(1)

    if (error) {
      return NextResponse.json(
        { ok: false, provider: 'supabase', status: 'database_error', latency_ms: Date.now() - startedAt },
        { status: 503 },
      )
    }

    return NextResponse.json({
      ok: true,
      provider: 'supabase',
      status: 'connected',
      latency_ms: Date.now() - startedAt,
    })
  } catch {
    return NextResponse.json(
      { ok: false, provider: 'supabase', status: 'configuration_error', latency_ms: Date.now() - startedAt },
      { status: 503 },
    )
  }
}
