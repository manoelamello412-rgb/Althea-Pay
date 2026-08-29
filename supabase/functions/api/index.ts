import { withSupabase } from 'npm:@supabase/server'

Deno.serve(withSupabase({ auth: 'user' }, async (req, ctx) => {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/functions\/v1\/api\/?/, '')

  if (req.method === 'GET' && path === 'me') {
    return Response.json({
      user: ctx.userClaims,
      authMode: ctx.authMode,
    })
  }

  if (req.method === 'GET' && path === 'health') {
    return Response.json({ ok: true, service: 'althea-api', version: 'v1' })
  }

  return Response.json({
    error: 'not_found',
    message: 'ALTHEA API endpoint not implemented yet',
  }, { status: 404 })
}))
