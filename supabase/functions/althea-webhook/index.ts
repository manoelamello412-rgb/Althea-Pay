import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-althea-signature, x-althea-event-id, x-althea-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const encoder = new TextEncoder()
const APPROVED = ['approved', 'paid', 'completed', 'success']
const REFUNDED = ['refunded', 'refund']
const CHARGEBACK = ['chargeback']

function hex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((x) => x.toString(16).padStart(2, '0')).join('')
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
function norm(value: unknown) { return String(value ?? '').trim().toLowerCase() }
function iso(value: unknown) {
  if (!value) return new Date().toISOString()
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error('invalid_occurred_at')
  return date.toISOString()
}

Deno.serve(withSupabase({ auth: 'none' }, async (req, ctx) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405, headers: corsHeaders })

  const raw = await req.text()
  const signature = req.headers.get('x-althea-signature') ?? ''
  const eventId = req.headers.get('x-althea-event-id') ?? ''
  const timestamp = req.headers.get('x-althea-timestamp') ?? ''
  const secret = Deno.env.get('ALTHEA_WEBHOOK_SECRET') ?? ''
  const db = ctx.supabaseAdmin

  try {
    if (!secret) return Response.json({ ok: false, error: 'webhook_secret_not_configured' }, { status: 503, headers: corsHeaders })
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000) {
      return Response.json({ ok: false, error: 'invalid_or_stale_timestamp' }, { status: 401, headers: corsHeaders })
    }
    if (!eventId) return Response.json({ ok: false, error: 'event_id_required' }, { status: 400, headers: corsHeaders })
    if (!safeEqual(signature, await hmac(secret, `${timestamp}.${raw}`))) {
      return Response.json({ ok: false, error: 'invalid_signature' }, { status: 401, headers: corsHeaders })
    }

    const p = JSON.parse(raw)
    const provider = String(p.provider ?? '').trim()
    const eventType = String(p.event_type ?? p.type ?? '').trim()
    const status = norm(p.status)
    const funnelId = p.funnel_id ? String(p.funnel_id) : null
    const gatewayId = p.gateway_connection_id ? String(p.gateway_connection_id) : null
    const organizationId = p.organization_id ? String(p.organization_id) : null
    const externalPaymentId = p.external_payment_id ? String(p.external_payment_id) : null
    const externalOrderId = p.external_order_id ? String(p.external_order_id) : null
    if (!provider || !eventType || !funnelId || !gatewayId) {
      return Response.json({ ok: false, error: 'provider_event_funnel_and_gateway_required' }, { status: 400, headers: corsHeaders })
    }

    const funnel = await db.from('funnels').select('id,organization_id').eq('id', funnelId).maybeSingle()
    if (funnel.error) throw funnel.error
    if (!funnel.data) return Response.json({ ok: false, error: 'funnel_not_found' }, { status: 404, headers: corsHeaders })
    const orgId = funnel.data.organization_id
    if (organizationId && organizationId !== orgId) return Response.json({ ok: false, error: 'organization_mismatch' }, { status: 403, headers: corsHeaders })

    const gateway = await db.from('gateway_connections').select('id,organization_id').eq('id', gatewayId).maybeSingle()
    if (gateway.error) throw gateway.error
    if (!gateway.data || gateway.data.organization_id !== orgId) return Response.json({ ok: false, error: 'gateway_not_found_or_mismatch' }, { status: 404, headers: corsHeaders })

    const event = await db.from('integration_events').insert({
      organization_id: orgId,
      funnel_id: funnelId,
      gateway_connection_id: gatewayId,
      provider,
      event_type: eventType,
      external_event_id: eventId,
      signature_valid: true,
      payload: p,
      created_at: new Date().toISOString(),
    }).select('id').single()

    if (event.error?.code === '23505') {
      const existing = await db.from('integration_events').select('id,processed_at').eq('provider', provider).eq('external_event_id', eventId).maybeSingle()
      return Response.json({ ok: true, duplicate: true, event_id: existing.data?.id ?? null, processed: Boolean(existing.data?.processed_at) }, { headers: corsHeaders })
    }
    if (event.error) throw event.error

    let customerId: string | null = p.customer_id ? String(p.customer_id) : null
    const customer = p.customer && typeof p.customer === 'object' ? p.customer : null
    if (customerId) {
      const existing = await db.from('customers').select('id').eq('id', customerId).eq('organization_id', orgId).maybeSingle()
      if (existing.error) throw existing.error
      if (!existing.data) customerId = null
    }
    if (!customerId && customer) {
      const email = customer.email ? String(customer.email).trim().toLowerCase() : null
      const externalReference = customer.external_reference ? String(customer.external_reference) : null
      let existing: any = null
      if (externalReference) {
        const q = await db.from('customers').select('id').eq('organization_id', orgId).eq('external_reference', externalReference).maybeSingle()
        if (q.error) throw q.error
        existing = q.data
      }
      if (!existing && email) {
        const q = await db.from('customers').select('id').eq('organization_id', orgId).eq('email', email).maybeSingle()
        if (q.error) throw q.error
        existing = q.data
      }
      if (existing) customerId = existing.id
      else {
        const created = await db.from('customers').insert({ organization_id: orgId, external_reference: externalReference, name: customer.name ?? null, email, phone: customer.phone ?? null, metadata: customer.metadata ?? {} }).select('id').single()
        if (created.error) throw created.error
        customerId = created.data.id
      }
    }

    const occurredAt = iso(p.occurred_at)
    const purchase = APPROVED.includes(status)
    const reversal = REFUNDED.includes(status) || CHARGEBACK.includes(status)
    let saleId: string | null = null

    if (purchase) {
      if (!externalPaymentId) throw new Error('external_payment_id_required_for_sale')
      const existing = await db.from('sales').select('id').eq('gateway_connection_id', gatewayId).eq('external_payment_id', externalPaymentId).maybeSingle()
      if (existing.error) throw existing.error
      const payload = {
        organization_id: orgId,
        funnel_id: funnelId,
        product_id: p.product_id ? String(p.product_id) : null,
        customer_id: customerId,
        gateway_connection_id: gatewayId,
        external_payment_id: externalPaymentId,
        external_order_id: externalOrderId,
        amount: Number(p.amount ?? 0),
        currency: String(p.currency ?? 'BRL').toUpperCase(),
        status: 'approved',
        source_event_id: event.data.id,
        metadata: p.metadata ?? p,
        occurred_at: occurredAt,
        updated_at: new Date().toISOString(),
      }
      if (existing.data) {
        saleId = existing.data.id
        const updated = await db.from('sales').update(payload).eq('id', saleId).eq('organization_id', orgId)
        if (updated.error) throw updated.error
      } else {
        const created = await db.from('sales').insert(payload).select('id').single()
        if (created.error) throw created.error
        saleId = created.data.id
      }
    }

    if (reversal && externalPaymentId) {
      const nextStatus = CHARGEBACK.includes(status) ? 'chargeback' : 'refunded'
      const updated = await db.from('sales').update({ status: nextStatus, source_event_id: event.data.id, metadata: p, updated_at: new Date().toISOString() }).eq('organization_id', orgId).eq('gateway_connection_id', gatewayId).eq('external_payment_id', externalPaymentId).select('id').maybeSingle()
      if (updated.error) throw updated.error
      saleId = updated.data?.id ?? null
    }

    await db.from('integration_events').update({ processed_at: new Date().toISOString() }).eq('id', event.data.id)
    return Response.json({ ok: true, duplicate: false, event_id: event.data.id, processed: true, sale_id: saleId, sale_synced: purchase || reversal }, { headers: corsHeaders })
  } catch (error) {
    console.error('althea-webhook', error)
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'webhook_processing_failed' }, { status: 500, headers: corsHeaders })
  }
}))
