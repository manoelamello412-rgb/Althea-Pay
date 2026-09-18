import { NextResponse } from 'next/server'
import { checkDatabaseHealth } from '@/lib/health/database-health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await checkDatabaseHealth()

  return NextResponse.json({
    ok: result.ok,
    provider: 'supabase',
    status: result.status,
    latency_ms: result.latency_ms,
    timestamp: new Date().toISOString(),
  }, {
    status: result.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
