import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-althea-signature, x-althea-event-id, x-althea-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const encoder = new TextEncoder()
const SUCCESS = ['approved', 'paid', 'completed', 'success']
const REVERSAL = ['refunded', 'refund', 'chargeback']

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

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function endpointKey(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const index = parts.indexOf('althea-webhook')
  return index >= 0 ? (parts[index + 1] ?? '') : ''
}

Deno.serve(
  withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: corsHeaders })

    const started = Date.now()
    const raw = await req.text()
    const signature = req.headers.get('x-althea-signature') ?? ''
    const eventId = req.headers.get('x-althea-event-id') ?? ''
    const timestamp = req.headers.get('x-althea-timestamp') ?? ''
    const key = endpointKey(req)
    const db = ctx.supabaseAdmin
    let deliveryId: string | null = null
    let eventIdDb: string | null = null

    try {
      if (!/^\d+$/.test(timestamp)) return Response.json({ ok: false, error: 'invalid_timestamp' }, { status: 400, headers: corsHeaders })
      if (Math.abs(Date.now() - Number(timestamp)) > 300000) return Response.json({ ok: false, error: 'stale_webhook' }, { status: 401, headers: corsHeaders })
      if (!eventId) return Response.json({ ok: false, error: 'event_id_required' }, { status: 400, headers: corsHeaders })

      let integration: any = null
      if (key) {
        const result = await db.from('webhook_integrations').select('id,user_id,funnel_id,provider,status,secret,vault_secret_id').eq('endpoint_key', key).eq('status', 'active').maybeSingle()
        if (result.error) throw result.error
        integration = result.data
        if (!integration) return Response.json({ ok: false, error: 'webhook_integration_not_found' }, { status: 404, headers: corsHeaders })
      }

      const secret = integration?.secret || Deno.env.get('ALTHEA_WEBHOOK_SECRET') || ''
      if (!secret) return Response.json({ ok: false, error: 'webhook_secret_not_configured' }, { status: 503, headers: corsHeaders })

      const expected = await hmac(secret, `${timestamp}.${raw}`)
      if (!safeEqual(signature, expected)) return Response.json({ ok: false, error: 'invalid_signature' }, { status: 401, headers: corsHeaders })

      const payload = JSON.parse(raw)
      const eventType = String(payload.event_type ?? payload.type ?? '').trim()
      const userId = integration?.user_id || String(payload.user_id ?? '')
      const funnelId = integration?.funnel_id || (payload.funnel_id ? String(payload.funnel_id) : null)
      const transactionId = payload.transaction_id ? String(payload.transaction_id) : null
      const checkoutId = payload.checkout_id ? String(payload.checkout_id) : null
      const externalId = payload.external_id ? String(payload.external_id) : null
      const status = norm(payload.status)

      if (!eventType || !userId || !funnelId) return Response.json({ ok: false, error: 'event_user_and_funnel_required' }, { status: 400, headers: corsHeaders })

      const delivery = await db.from('webhook_deliveries').insert({ user_id: userId, integration_id: integration?.id ?? null, event_type: eventType, endpoint: new URL(req.url).pathname, signature_valid: true, status: 'received', attempt: 1, payload }).select('id').single()
      if (delivery.error) throw delivery.error
      deliveryId = delivery.data.id

      const eventKey = `${integration?.id || userId}:${eventId}`
      const existing = await db.from('integration_events').select('id,status').eq('event_key', eventKey).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data) {
        await db.from('webhook_deliveries').update({ status: 'duplicate', response_code: 200, response_time_ms: Date.now() - started, delivered_at: new Date().toISOString() }).eq('id', deliveryId)
        return Response.json({ ok: true, duplicate: true, event_id: existing.data.id, status: existing.data.status }, { headers: corsHeaders })
      }

      const event = await db.from('integration_events').insert({ user_id: userId, funnel_id: funnelId, integration_id: integration?.id ?? null, event_type: eventType, external_id: eventId, event_key: eventKey, status: 'processing', payload, occurred_at: new Date(Number(timestamp)).toISOString(), claim_attempt: 0 }).select('id').single()
      if (event.error) throw event.error
      eventIdDb = event.data.id

      let transaction: any = null
      if (transactionId) {
        const result = await db.from('gateway_transactions').select('*').eq('id', transactionId).eq('user_id', userId).maybeSingle()
        if (result.error) throw result.error
        transaction = result.data
        if (transaction) {
          const nextStatus = status || transaction.status
          const transitioned = await db.rpc('transition_gateway_transaction_status', {
            p_transaction_id: transaction.id,
            p_user_id: userId,
            p_next_status: nextStatus,
            p_failure_code: payload.failure_code ? String(payload.failure_code) : null,
            p_external_id: externalId,
          })
          if (transitioned.error) throw transitioned.error
          transaction = transitioned.data
        }
      }

      let checkout: any = null
      if (checkoutId) {
        const result = await db.from('checkout_sessions').select('*').eq('id', checkoutId).eq('user_id', userId).maybeSingle()
        if (result.error) throw result.error
        checkout = result.data
        if (checkout) {
          const next = SUCCESS.includes(status) ? 'completed' : REVERSAL.includes(status) ? 'failed' : null
          if (next) {
            const updated = await db.from('checkout_sessions').update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', checkoutId).eq('user_id', userId)
            if (updated.error) throw updated.error
          }
        }
      }

      const purchase = SUCCESS.includes(status) && (eventType.toLowerCase().includes('payment') || eventType.toLowerCase().includes('purchase') || SUCCESS.includes(eventType.toLowerCase()))
      const reversal = REVERSAL.includes(status) || REVERSAL.includes(norm(eventType))
      let saleId: string | null = null

      if (purchase && transaction) {
        const saleExternalId = externalId || transaction.external_id || eventId
        const attribution = checkout?.attribution && typeof checkout.attribution === 'object' ? checkout.attribution : {}
        const sale: any = {
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
          user_id: userId,
        }
        const existingSale = await db.from('sales').select('id').eq('user_id', userId).eq('external_id', saleExternalId).maybeSingle()
        if (existingSale.error) throw existingSale.error
        if (existingSale.data) {
          saleId = existingSale.data.id
          const updated = await db.from('sales').update(sale).eq('id', saleId).eq('user_id', userId)
          if (updated.error) throw updated.error
        } else {
          const inserted = await db.from('sales').insert({ ...sale, id: `sale_${eventId}` }).select('id').single()
          if (inserted.error) throw inserted.error
          saleId = inserted.data.id
        }
      }

      if (reversal) {
        const saleExternalId = externalId || transaction?.external_id || eventId
        const updated = await db.from('sales').update({ status: status === 'chargeback' || norm(eventType) === 'chargeback' ? 'chargeback' : 'refunded', data: payload }).eq('user_id', userId).eq('external_id', saleExternalId)
        if (updated.error) throw updated.error
      }

      const internalSecret = Deno.env.get('ALTHEA_INTERNAL_SECRET') || ''
      let automationTriggered = false
      let universalWebhookTriggered = false
      if (internalSecret) {
        const automationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/automation-engine-v2`
        const automationResponse = await fetch(automationUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret }, body: JSON.stringify({ user_id: userId, funnel_id: funnelId, event_id: event.data.id, event_type: eventType, transaction_id: transactionId, checkout_id: checkoutId, sale_id: saleId, external_id: externalId, payload }) })
        automationTriggered = automationResponse.ok
        if (!automationResponse.ok) throw new Error(`automation_engine_http_${automationResponse.status}`)
        if (purchase) {
          const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outbound-webhook-dispatcher`
          const webhookResponse = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret }, body: JSON.stringify({ user_id: userId, event_id: event.data.id, event_type: 'order.approved', event_db_id: event.data.id, payload: { ...payload, sale_id: saleId, transaction_id: transactionId, funnel_id: funnelId } }) })
          universalWebhookTriggered = webhookResponse.ok
          if (!webhookResponse.ok) throw new Error(`outbound_webhook_http_${webhookResponse.status}`)
        }
      }

      await db.from('integration_events').update({ status: 'processed', processed_at: new Date().toISOString(), error_message: null }).eq('id', event.data.id)
      await db.from('webhook_deliveries').update({ status: 'delivered', response_code: 200, response_time_ms: Date.now() - started, delivered_at: new Date().toISOString() }).eq('id', deliveryId)
      return Response.json({ ok: true, duplicate: false, event_id: event.data.id, processed: true, sale_id: saleId, sale_synced: purchase || reversal, automation_triggered: automationTriggered, universal_webhook_triggered: universalWebhookTriggered }, { headers: corsHeaders })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'webhook_processing_failed'
      console.error('althea-webhook', error)
      if (eventIdDb) {
        const existingEvent = await db.from('integration_events').select('retry_count').eq('id', eventIdDb).maybeSingle()
        await db.from('integration_events').update({ status: 'retry', retry_count: Number(existingEvent.data?.retry_count ?? 0) + 1, error_message: message }).eq('id', eventIdDb)
      }
      if (deliveryId) await db.from('webhook_deliveries').update({ status: 'failed', response_code: 500, response_time_ms: Date.now() - started, error_message: message }).eq('id', deliveryId)
      return Response.json({ ok: false, error: message, event_id: eventIdDb, retryable: Boolean(eventIdDb) }, { status: 500, headers: corsHeaders })
    }
  }),
)
