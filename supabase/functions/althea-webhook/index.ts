import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-althea-signature, x-althea-event-id, x-althea-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const textEncoder = new TextEncoder()

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, textEncoder.encode(value)))
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: corsHeaders })

  const raw = await req.text()
  const signature = req.headers.get('x-althea-signature') || ''
  const eventId = req.headers.get('x-althea-event-id') || crypto.randomUUID()
  const timestamp = req.headers.get('x-althea-timestamp') || ''
  const secret = Deno.env.get('ALTHEA_WEBHOOK_SECRET') || ''

  if (!secret) return Response.json({ ok: false, error: 'webhook_secret_not_configured' }, { status: 503, headers: corsHeaders })
  if (!timestamp || !/^\d+$/.test(timestamp)) return Response.json({ ok: false, error: 'invalid_timestamp' }, { status: 400, headers: corsHeaders })

  const age = Math.abs(Date.now() - Number(timestamp))
  if (age > 5 * 60 * 1000) return Response.json({ ok: false, error: 'stale_webhook' }, { status: 401, headers: corsHeaders })

  const expected = await hmac(secret, `${timestamp}.${raw}`)
  if (!safeEqual(signature, expected)) return Response.json({ ok: false, error: 'invalid_signature' }, { status: 401, headers: corsHeaders })

  try {
    const payload = JSON.parse(raw)
    const eventType = String(payload.event_type || payload.type || 'unknown')
    const userId = String(payload.user_id || '')
    const funnelId = payload.funnel_id ? String(payload.funnel_id) : null
    const checkoutId = payload.checkout_id ? String(payload.checkout_id) : null
    const transactionId = payload.transaction_id ? String(payload.transaction_id) : null
    const status = String(payload.status || '')
    const eventKey = `${userId}:${eventId}`

    if (!userId || !funnelId) {
      return Response.json({ ok: false, error: 'user_id_and_funnel_id_required' }, { status: 400, headers: corsHeaders })
    }

    const admin = ctx.supabaseAdmin
    const { data: existing } = await admin.from('integration_events').select('id,status').eq('event_key', eventKey).maybeSingle()
    if (existing) return Response.json({ ok: true, duplicate: true, event_id: existing.id }, { headers: corsHeaders })

    const { data: event, error } = await admin.from('integration_events').insert({
      user_id: userId,
      funnel_id: funnelId,
      event_type: eventType,
      external_id: eventId,
      event_key: eventKey,
      status: 'processing',
      payload,
      occurred_at: timestamp ? new Date(Number(timestamp)).toISOString() : new Date().toISOString(),
    }).select('id').single()
    if (error) throw error

    if (transactionId) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (status) patch.status = status
      if (payload.failure_code) patch.failure_code = String(payload.failure_code)
      if (payload.external_id) patch.external_id = String(payload.external_id)
      await admin.from('gateway_transactions').update(patch).eq('id', transactionId).eq('user_id', userId)
    }

    if (checkoutId) {
      const checkoutStatus = ['approved', 'paid', 'completed', 'success'].includes(status.toLowerCase()) ? 'completed' :
        ['failed', 'declined', 'cancelled', 'canceled', 'refunded'].includes(status.toLowerCase()) ? 'failed' : null
      if (checkoutStatus) {
        await admin.from('checkout_sessions').update({
          status: checkoutStatus,
          completed_at: checkoutStatus === 'completed' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq('id', checkoutId).eq('user_id', userId)
      }
      await admin.from('checkout_events').insert({
        checkout_id: checkoutId,
        event_type: eventType,
        external_id: eventId,
        payload,
      })
    }

    await admin.from('integration_events').update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', event.id)

    return Response.json({ ok: true, duplicate: false, event_id: event.id, processed: true }, { headers: corsHeaders })
  } catch (error) {
    console.error('althea-webhook', error)
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'webhook_processing_failed' }, { status: 500, headers: corsHeaders })
  }
}))
