import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-althea-signature, x-althea-timestamp, x-althea-event-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const encoder = new TextEncoder()

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } })
}
function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}
function endpointKey(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const index = parts.indexOf('integration-webhook')
  return index >= 0 ? parts[index + 1] ?? '' : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const requestId = crypto.randomUUID()
  const raw = await req.text()
  const timestamp = req.headers.get('x-althea-timestamp') ?? ''
  const signature = req.headers.get('x-althea-signature') ?? ''
  const suppliedEventId = req.headers.get('x-althea-event-id') ?? ''

  try {
    if (!/^\d+$/.test(timestamp)) return json({ ok: false, error: 'invalid_timestamp' }, 400)
    if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return json({ ok: false, error: 'timestamp_out_of_window' }, 401)

    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ ok: false, error: 'invalid_payload' }, 400)
      payload = parsed as Record<string, unknown>
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400)
    }

    const eventId = suppliedEventId || String(payload.id ?? payload.event_id ?? '')
    if (!eventId || eventId.length > 300) return json({ ok: false, error: 'event_id_required' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'supabase_service_configuration_missing' }, 503)

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const key = endpointKey(req)
    if (!key || key.length > 300) return json({ ok: false, error: 'webhook_endpoint_required' }, 400)

    const integration = await db.rpc('get_webhook_integration', { p_endpoint_key: key })
    if (integration.error) throw integration.error
    const row = Array.isArray(integration.data) ? (integration.data[0] ?? null) : integration.data
    if (!row) return json({ ok: false, error: 'webhook_integration_not_found' }, 404)
    const secret = String(row.secret ?? '')
    if (!secret) return json({ ok: false, error: 'webhook_secret_not_configured' }, 503)

    const expected = await hmac(secret, `${timestamp}.${raw}`)
    if (!safeEqual(signature, expected)) return json({ ok: false, error: 'invalid_signature' }, 401)

    const existing = await db.from('webhook_events').select('event_id').eq('event_id', eventId).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return json({ ok: true, duplicate: true, event_id: eventId })

    const inserted = await db.from('webhook_events').insert({ event_id: eventId, payload })
    if (inserted.error) throw inserted.error

    return json({ ok: true, duplicate: false, event_id: eventId, request_id: requestId })
  } catch (error) {
    console.error('integration-webhook', { requestId, error })
    return json({ ok: false, error: error instanceof Error ? error.message : 'webhook_processing_failed', request_id: requestId }, 500)
  }
})
