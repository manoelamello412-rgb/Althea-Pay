import { withSupabase } from 'npm:@supabase/server'
import { canTransitionFinancialState, normalizeFinancialState } from '../_shared/financial-state'

const SUCCESS = ['approved', 'paid', 'completed', 'success']
const REVERSAL = ['refunded', 'refund', 'chargeback']
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'content-type': 'application/json' } })

Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const secret = Deno.env.get('ALTHEA_INTERNAL_SECRET') || ''
  if (!secret || req.headers.get('x-internal-secret') !== secret) return json({ ok: false, error: 'unauthorized' }, 401)

  try {
    const body = await req.json()
    const eventId = String(body?.event_id || '')
    if (!eventId) return json({ ok: false, error: 'event_id_required' }, 400)
    const db = ctx.supabaseAdmin
    const found = await db.from('integration_events').select('*').eq('id', eventId).maybeSingle()
    if (found.error) throw found.error
    if (!found.data) return json({ ok: false, error: 'event_not_found' }, 404)
    const event = found.data
    if (event.status === 'processed') return json({ ok: true, already_processed: true, event_id: event.id })

    const p = event.payload || {}
    const userId = String(event.user_id)
    const funnelId = String(event.funnel_id)
    const eventType = String(event.event_type || '')
    const status = String(p.status ?? '').trim().toLowerCase()
    const nextState = normalizeFinancialState(p.status)
    const transactionId = p.transaction_id ? String(p.transaction_id) : null
    const checkoutId = p.checkout_id ? String(p.checkout_id) : null
    const externalId = p.external_id ? String(p.external_id) : null

    let transaction: any = null
    if (transactionId) {
      const r = await db.from('gateway_transactions').select('*').eq('id', transactionId).eq('user_id', userId).maybeSingle()
      if (r.error) throw r.error
      transaction = r.data
      if (transaction && nextState && canTransitionFinancialState(normalizeFinancialState(transaction.status), nextState)) {
        const tr = await db.rpc('transition_gateway_transaction_status', {
          p_transaction_id: transaction.id, p_user_id: userId, p_next_status: nextState,
          p_failure_code: p.failure_code ? String(p.failure_code) : null, p_external_id: externalId,
        })
        if (tr.error) throw tr.error
        transaction = Array.isArray(tr.data) ? tr.data[0] ?? transaction : tr.data ?? transaction
      }
    }

    let checkout: any = null
    if (checkoutId) {
      const r = await db.from('checkout_sessions').select('*').eq('id', checkoutId).eq('user_id', userId).maybeSingle()
      if (r.error) throw r.error
      checkout = r.data
      if (checkout) {
        const next = SUCCESS.includes(status) ? 'completed' : REVERSAL.includes(status) ? 'failed' : null
        if (next) {
          const u = await db.from('checkout_sessions').update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', checkoutId).eq('user_id', userId)
          if (u.error) throw u.error
        }
      }
    }

    const purchase = SUCCESS.includes(status) && (eventType.toLowerCase().includes('payment') || eventType.toLowerCase().includes('purchase') || ['paid', 'approved', 'completed', 'success'].includes(eventType.toLowerCase()))
    const reversal = REVERSAL.includes(status) || REVERSAL.includes(eventType.toLowerCase())
    let saleId: string | null = null
    const saleExternalId = externalId || transaction?.external_id || String(event.external_id || event.id)

    if (purchase && transaction) {
      const attribution = checkout?.attribution && typeof checkout.attribution === 'object' ? checkout.attribution : {}
      const sale = {
        funnel_id: funnelId, product_id: checkout?.product_id ?? transaction.product_id ?? null,
        checkout_id: checkoutId, transaction_id: transaction.id,
        amount: transaction.amount ?? checkout?.amount ?? p.amount ?? 0,
        currency: transaction.currency ?? checkout?.currency ?? p.currency ?? 'BRL', status: 'approved', attribution,
        source: attribution.source ?? null, medium: attribution.medium ?? null, campaign: attribution.campaign ?? null,
        content: attribution.content ?? null, term: attribution.term ?? null, click_id: attribution.click_id ?? null,
        external_id: saleExternalId, gateway_id: transaction.gateway_id ?? null,
        occurred_at: event.occurred_at || new Date().toISOString(), data: p, user_id: userId,
      }
      const ex = await db.from('sales').select('id').eq('user_id', userId).eq('external_id', saleExternalId).maybeSingle()
      if (ex.error) throw ex.error
      if (ex.data) {
        saleId = ex.data.id
        const u = await db.from('sales').update(sale).eq('id', saleId).eq('user_id', userId)
        if (u.error) throw u.error
      } else {
        const i = await db.from('sales').insert({ id: `sale_${String(event.external_id || event.id)}`, ...sale }).select('id').single()
        if (i.error && i.error.code === '23505') {
          const again = await db.from('sales').select('id').eq('user_id', userId).eq('external_id', saleExternalId).maybeSingle()
          if (again.error || !again.data) throw i.error
          saleId = again.data.id
        } else if (i.error) throw i.error
        else saleId = i.data.id
      }
    }

    if (reversal) {
      const u = await db.from('sales').update({ status: status === 'chargeback' || eventType.toLowerCase() === 'chargeback' ? 'chargeback' : 'refunded', data: p }).eq('user_id', userId).eq('external_id', saleExternalId)
      if (u.error) throw u.error
    }

    const internalSecret = secret
    const automationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/automation-engine-v2`
    const ar = await fetch(automationUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret }, body: JSON.stringify({ user_id: userId, funnel_id: funnelId, event_id: event.id, event_type: eventType, transaction_id: transactionId, checkout_id: checkoutId, sale_id: saleId, external_id: externalId, payload: p }) })
    if (!ar.ok) throw new Error(`automation_engine_http_${ar.status}`)

    if (purchase) {
      const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outbound-webhook-dispatcher`
      const wr = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret }, body: JSON.stringify({ user_id: userId, event_id: event.id, event_type: 'order.approved', event_db_id: event.id, payload: { ...p, sale_id: saleId, transaction_id: transactionId, funnel_id: funnelId } }) })
      if (!wr.ok) throw new Error(`outbound_webhook_http_${wr.status}`)
    }

    const updated = await db.from('integration_events').update({ status: 'processed', processed_at: new Date().toISOString(), error_message: null }).eq('id', event.id).in('status', ['retry', 'processing']).select('id,status').maybeSingle()
    if (updated.error) throw updated.error
    return json({ ok: true, processed: true, event_id: event.id, sale_id: saleId })
  } catch (error) {
    console.error('integration-event-processor', error)
    return json({ ok: false, error: 'integration_event_processing_failed' }, 500)
  }
}))
