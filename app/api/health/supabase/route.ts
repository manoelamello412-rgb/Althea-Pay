import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()

  try {
    await createSupabaseServerClient()
    return NextResponse.json({
      ok: true,
      provider: 'supabase',
      status: 'configured',
      latency_ms: Date.now() - startedAt,
    })
  } catch {
    return NextResponse.json(
      { ok: false, provider: 'supabase', status: 'configuration_error', latency_ms: Date.now() - startedAt },
      { status: 503 },
    )
  }
}
