import { withSupabase } from 'npm:@supabase/server'

// External gateways do not send Supabase user JWTs. The function therefore
// accepts the request without platform JWT validation and verifies the gateway
// signature inside the handler before persisting anything sensitive.
Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const provider = req.headers.get('x-althea-provider') ?? 'unknown'
  const externalEventId = req.headers.get('x-althea-event-id')
  const signature = req.headers.get('x-althea-signature')

  // Provider-specific signature verification belongs here. Never trust a
  // webhook merely because it reached this endpoint.
  if (!signature) {
    return Response.json({ error: 'missing_signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  // The next connector layer will resolve provider/account/funnel and then
  // write an idempotent integration_events row using ctx.supabaseAdmin.
  return Response.json({
    accepted: true,
    provider,
    externalEventId,
    receivedAt: new Date().toISOString(),
    payloadReceived: payload !== null,
  }, { status: 202 })
}))
