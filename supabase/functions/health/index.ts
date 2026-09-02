import { withSupabase } from 'npm:@supabase/server'

Deno.serve(withSupabase({ auth: 'none' }, async (_req, ctx) => {
  const started = Date.now()
  let database: 'ok' | 'error' = 'ok'

  try {
    const { error } = await ctx.supabaseAdmin.from('platform_settings').select('user_id').limit(1)
    if (error) database = 'error'
  } catch {
    database = 'error'
  }

  const ok = database === 'ok'
  return Response.json({
    ok,
    service: 'althea-api',
    version: 'v1',
    status: ok ? 'ok' : 'degraded',
    checks: { database, queue: 'managed-by-event-worker' },
    latency_ms: Date.now() - started,
    timestamp: new Date().toISOString(),
    authMode: ctx.authMode,
  }, { status: ok ? 200 : 503 })
}))
