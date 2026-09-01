import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-althea-signature, x-althea-event-id, x-althea-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const encoder = new TextEncoder()
const SUCCESS = ['approved', 'paid', 'completed', 'success']
const FAILURE = ['failed', 'declined', 'cancelled', 'canceled', 'expired']

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

function normalizedStatus(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
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
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return Response.json({ ok: false, error: 'stale_webhook' }, { status: 401, headers: corsHeaders })

  const expected = await hmac(secret, `${timestamp}.${raw}`)
  if (!safeEqual(signature, expected)) return Response.json({ ok: false, error: 'invalid_signature' }, { status: 401, headers: corsHeaders })

  try {
    const payload = JSON.parse(raw)
    const eventType = String(payload.event_type || payload.type || 'unknown')
    const userId = String(payload.user_id || '')
    const funnelId = payload.funnel_id ? String(payload.funnel_id) : null
    const checkoutId = payload.checkout_id ? String(payload.checkout_id) : null
    const transactionId = payload.transaction_id ? String(payload.transaction_id) : null
    const providerExternalId = payload.external_id ? String(payload.external_id) : null
    const status = normalizedStatus(payload.status)

    if (!userId || !funnelId) return Response.json({ ok: false, error: 'user_id_and_funnel_id_required' }, { status: 400, headers: corsHeaders })

    const admin = ctx.supabaseAdmin
    const eventKey = `${userId}:${eventId}`
    const { data: existing } = await admin.from('integration_events').select('id,status').eq('event_key', eventKey).maybeSingle()
    if (existing) return Response.json({ ok: true, duplicate: true, event_id: existing.id, status: existing.status }, { headers: corsHeaders })

    const { data: event, error: eventError } = await admin.from('integration_events').insert({
      user_id: userId,
      funnel_id: funnelId,
      event_type: eventType,
      external_id: eventId,
      event_key: eventKey,
      status: 'processing',
      payload,
      occurred_at: timestamp ? new Date(Number(timestamp)).toISOString() : new Date().toISOString(),
    }).select('id').single()
    if (eventError) throw eventError

    let transaction: any = null
    if (transactionId) {
      const { data, error } = await admin.from('gateway_transactions').select('*').eq('id', transactionId).eq('user_id', userId).maybeSingle()
      if (error) throw error
      transaction = data
      if (transaction) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (status) patch.status = status
        if (payload.failure_code) patch.failure_code = String(payload.failure_code)
        if (providerExternalId) patch.external_id = providerExternalId
        const { error: txError } = await admin.from('gateway_transactions').update(patch).eq('id', transaction.id).eq('user_id', userId)
        if (txError) throw txError
        transaction = { ...transaction, ...patch }
      }
    }

    let checkout: any = null
    if (checkoutId) {
      const { data, error } = await admin.from('checkout_sessions').select('*').eq('id', checkoutId).eq('user_id', userId).maybeSingle()
      if (error) throw error
      checkout = data

      const checkoutStatus = SUCCESS.includes(status) ? 'completed' : FAILURE.includes(status) || status === 'refunded' ? 'failed' : null
      if (checkoutStatus) {
        const patch = {
          status: checkoutStatus,
          completed_at: checkoutStatus === 'completed' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }
        const { error: checkoutError } = await admin.from('checkout_sessions').update(patch).eq('id', checkoutId).eq('user_id', userId)
        if (checkoutError) throw checkoutError
      }

      const { error: checkoutEventError } = await admin.from('checkout_events').upsert({
        user_id: userId,
        checkout_id: checkoutId,
        event_type: eventType,
        external_id: eventId,
        payload,
      }, { onConflict: 'checkout_id,external_id', ignoreDuplicates: true })
      if (checkoutEventError) throw checkoutEventError
    }

    const isPurchase = SUCCESS.includes(status) && ['purchase', 'payment.approved', 'payment_approved', 'sale.approved', 'paid', 'approved'].includes(eventType.toLowerCase())
    const isReversal = ['refunded', 'chargeback'].includes(status) || ['refund', 'refunded', 'chargeback'].includes(eventType.toLowerCase())

    if (isPurchase && transaction) {
      const attribution = checkout?.attribution && typeof checkout.attribution === 'object' ? checkout.attribution : {}
      const saleExternalId = providerExternalId || transaction.external_id || eventId
      const saleData = {
        funnel_id: funnelId,
        product_id: checkout?.product_id ?? transaction.product_id ?? null,
        checkout_id: checkoutId,
        transaction_id: transaction.id,
        amount: transaction.amount ?? checkout?.amount ?? payload.amount ?? 0,
        currency: transaction.currency ?? checkout?.currency ?? payload.currency ?? 'BRL',
        status: 'approved',
        attribution,
        source: attribution.source ?? null,
        medium: attribution.medium ?? null,
        campaign: attribution.campaign ?? null,
        content: attribution.content ?? null,
        term: attribution.term ?? null,
        click_id: attribution.click_id ?? null,
        external_id: saleExternalId,
        gateway_id: transaction.gateway_id ?? null,
        occurred_at: new Date(Number(timestamp)).toISOString(),
        data: payload,
      }
      const { data: existingSale } = await admin.from('sales').select('id').eq('user_id', userId).eq('external_id', saleExternalId).maybeSingle()
      if (existingSale) {
        const { error: saleUpdateError } = await admin.from('sales').update(saleData).eq('id', existingSale.id).eq('user_id', userId)
        if (saleUpdateError) throw saleUpdateError
      } else {
        const { error: saleInsertError } = await admin.from('sales').insert({ id: `sale_${eventId}`, user_id: userId, ...saleData })
        if (saleInsertError) throw saleInsertError
      }
    }

    if (isReversal) {
      const saleExternalId = providerExternalId || transaction?.external_id || eventId
      const { error: reversalError } = await admin.from('sales').update({ status: status === 'chargeback' ? 'chargeback' : 'refunded', data: payload }).eq('user_id', userId).eq('external_id', saleExternalId)
      if (reversalError) throw reversalError
    }

    await admin.from('integration_events').update({ status: 'processed', processed_at: new Date().toISOString(), error_message: null }).eq('id', event.id)

    return Response.json({ ok: true, duplicate: false, event_id: event.id, processed: true, sale_synced: isPurchase || isReversal }, { headers: corsHeaders })
  } catch (error) {
    console.error('althea-webhook', error)
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'webhook_processing_failed' }, { status: 500, headers: corsHeaders })
  }
}))
