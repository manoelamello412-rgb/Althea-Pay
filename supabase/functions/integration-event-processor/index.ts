import { withSupabase } from 'npm:@supabase/server'

const SUCCESS = ['approved', 'paid', 'completed', 'success']
const REVERSAL = ['refunded', 'refund', 'chargeback']
const ALLOWED: Record<string, string[]> = {
  created: ['created', 'pending', 'approved', 'failed'],
  pending: ['pending', 'approved', 'failed', 'refunded', 'chargeback'],
  approved: ['approved', 'refunded', 'chargeback'],
  failed: ['failed'], refunded: ['refunded'], chargeback: ['chargeback'],
}
const aliases: Record<string, string> = { paid: 'approved', completed: 'approved', success: 'approved', refund: 'refunded', reversed: 'refunded', charged_back: 'chargeback' }
const normalize = (value: unknown) => aliases[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase()
const canTransition = (from: string, to: string) => Boolean(ALLOWED[from] && ALLOWED[from].includes(to))
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'content-type': 'application/json' } })

Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const secret = Deno.env.get('ALTHEA_INTERNAL_SECRET') || ''
  if (!secret || req.headers.get('x-internal-secret') !== secret) return json({ ok: false, error: 'unauthorized' }, 401)
  try {
    const body = await req.json() as { event_id?: string }
    const eventId = String(body.event_id || '')
    if (!eventId) return json({ ok: false, error: 'event_id_required' }, 400)
    const db = ctx.supabaseAdmin
    const result = await db.from('integration_events').select('*').eq('id', eventId).maybeSingle()
    if (result.error) throw result.error
    if (!result.data) return json({ ok: false, error: 'event_not_found' }, 404)
    const event = result.data
    if (event.status === 'processed') return json({ ok: true, already_processed: true, event_id: event.id })
    const payload = (event.payload || {}) as Record<string, any>
    const userId = String(event.user_id), funnelId = String(event.funnel_id), eventType = String(event.event_type || '')
    const status = String(payload.status || '').trim().toLowerCase(), nextState = normalize(payload.status)
    const transactionId = payload.transaction_id ? String(payload.transaction_id) : '', checkoutId = payload.checkout_id ? String(payload.checkout_id) : '', externalId = payload.external_id ? String(payload.external_id) : ''
    let transaction: Record<string, any> | null = null
    if (transactionId) {
      const tx = await db.from('gateway_transactions').select('*').eq('id', transactionId).eq('user_id', userId).maybeSingle(); if (tx.error) throw tx.error; transaction = tx.data
      if (transaction && nextState && canTransition(normalize(transaction.status), nextState)) {
        const transitioned = await db.rpc('transition_gateway_transaction_status', { p_transaction_id: transaction.id, p_user_id: userId, p_next_status: nextState, p_failure_code: payload.failure_code ? String(payload.failure_code) : null, p_external_id: externalId || null }); if (transitioned.error) throw transitioned.error; transaction = Array.isArray(transitioned.data) ? transitioned.data[0] : transitioned.data
      }
    }
    let checkout: Record<string, any> | null = null
    if (checkoutId) {
      const cs = await db.from('checkout_sessions').select('*').eq('id', checkoutId).eq('user_id', userId).maybeSingle(); if (cs.error) throw cs.error; checkout = cs.data
      if (checkout) { const nextCheckout = SUCCESS.includes(status) ? 'completed' : REVERSAL.includes(status) ? 'failed' : ''; if (nextCheckout) { const updated = await db.from('checkout_sessions').update({ status: nextCheckout, completed_at: nextCheckout === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', checkoutId).eq('user_id', userId); if (updated.error) throw updated.error } }
    }
    const normalizedEventType = eventType.toLowerCase(), purchase = SUCCESS.includes(status) && (normalizedEventType.includes('payment') || normalizedEventType.includes('purchase') || SUCCESS.includes(normalizedEventType)), reversal = REVERSAL.includes(status) || REVERSAL.includes(normalizedEventType)
    const saleExternalId = externalId || String(transaction?.external_id || event.external_id || event.id); let saleId = ''
    if (purchase && transaction) {
      const attribution = checkout && checkout.attribution && typeof checkout.attribution === 'object' ? checkout.attribution : {}
      const sale = { funnel_id: funnelId, product_id: checkout?.product_id || transaction.product_id || null, checkout_id: checkoutId || null, transaction_id: transaction.id, amount: transaction.amount || checkout?.amount || payload.amount || 0, currency: transaction.currency || checkout?.currency || payload.currency || 'BRL', status: 'approved', attribution, source: attribution.source || null, medium: attribution.medium || null, campaign: attribution.campaign || null, content: attribution.content || null, term: attribution.term || null, click_id: attribution.click_id || null, external_id: saleExternalId, gateway_id: transaction.gateway_id || null, occurred_at: event.occurred_at || new Date().toISOString(), data: payload, user_id: userId }
      const existing = await db.from('sales').select('id').eq('user_id', userId).eq('external_id', saleExternalId).maybeSingle(); if (existing.error) throw existing.error
      if (existing.data) { saleId = String(existing.data.id); const update = await db.from('sales').update(sale).eq('id', saleId).eq('user_id', userId); if (update.error) throw update.error }
      else { const inserted = await db.from('sales').insert({ id: `sale_${String(event.external_id || event.id)}`, ...sale }).select('id').single(); if (inserted.error && inserted.error.code === '23505') { const retry = await db.from('sales').select('id').eq('user_id', userId).eq('external_id', saleExternalId).maybeSingle(); if (retry.error || !retry.data) throw inserted.error; saleId = String(retry.data.id) } else if (inserted.error) throw inserted.error; else saleId = String(inserted.data.id) }
    }
    if (reversal) { const saleStatus = status === 'chargeback' || normalizedEventType === 'chargeback' ? 'chargeback' : 'refunded'; const update = await db.from('sales').update({ status: saleStatus, data: payload }).eq('user_id', userId).eq('external_id', saleExternalId); if (update.error) throw update.error }
    const automation = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/automation-engine-v2`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ user_id: userId, funnel_id: funnelId, event_id: event.id, event_type: eventType, transaction_id: transactionId || null, checkout_id: checkoutId || null, sale_id: saleId || null, external_id: externalId || null, payload }) }); if (!automation.ok) throw new Error(`automation_engine_http_${automation.status}`)
    if (purchase) { const webhook = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/outbound-webhook-dispatcher`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ user_id: userId, event_id: event.id, event_type: 'order.approved', event_db_id: event.id, payload: { ...payload, sale_id: saleId || null, transaction_id: transactionId || null, funnel_id: funnelId } }) }); if (!webhook.ok) throw new Error(`outbound_webhook_http_${webhook.status}`) }
    const marked = await db.from('integration_events').update({ status: 'processed', processed_at: new Date().toISOString(), error_message: null }).eq('id', event.id).in('status', ['retry', 'processing']).select('id').maybeSingle(); if (marked.error) throw marked.error
    return json({ ok: true, processed: true, event_id: event.id, sale_id: saleId || null })
  } catch (error) { console.error('integration-event-processor', error); return json({ ok: false, error: 'integration_event_processing_failed' }, 500) }
}))
