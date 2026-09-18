import { NextResponse } from 'next/server'
import { checkDatabaseHealth } from '@/lib/health/database-health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  const database = await checkDatabaseHealth()
  const ok = database.ok

  return NextResponse.json({
    ok,
    service: 'althea-web',
    status: ok ? 'ok' : 'degraded',
    checks: {
      runtime: 'ok',
      database: database.status,
    },
    database_latency_ms: database.latency_ms,
    latency_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
