import { withSupabase } from 'npm:@supabase/server'

Deno.serve(withSupabase({ auth: 'none' }, async (_req, ctx) => {
  return Response.json({
    ok: true,
    service: 'althea-api',
    version: 'v1',
    timestamp: new Date().toISOString(),
    authMode: ctx.authMode,
  })
}))
