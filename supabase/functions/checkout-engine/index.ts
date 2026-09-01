import { withSupabase } from 'npm:@supabase/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(withSupabase({ auth: 'user' }, async (req, ctx) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const funnelId = String(body.funnel_id || '')
    const productId = body.product_id ? String(body.product_id) : null
    const amount = Number(body.amount)
    const currency = String(body.currency || 'BRL').toUpperCase()
    const action = String(body.action || 'start')
    const idempotencyKey = String(body.idempotency_key || req.headers.get('idempotency-key') || crypto.randomUUID())

    if (!funnelId || !Number.isFinite(amount) || amount <= 0) {
      return Response.json({ ok: false, error: 'funnel_id and a positive amount are required' }, { status: 400, headers: corsHeaders })
    }

    const authHeader = req.headers.get('authorization')
    if (!authHeader) return Response.json({ ok: false, error: 'Missing authorization' }, { status: 401, headers: corsHeaders })

    const supabase = ctx.supabase
    const { data: existing } = await supabase
      .from('checkout_sessions')
      .select('*')
      .contains('metadata', { idempotency_key: idempotencyKey })
      .maybeSingle()

    if (existing) return Response.json({ ok: true, replay: true, checkout: existing }, { headers: corsHeaders })

    const customer = body.customer && typeof body.customer === 'object' ? body.customer : {}
    const attribution = body.attribution && typeof body.attribution === 'object' ? body.attribution : {}
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}

    const { data: checkout, error: checkoutError } = await supabase
      .from('checkout_sessions')
      .insert({
        funnel_id: funnelId,
        product_id: productId,
        status: action === 'purchase' ? 'processing' : 'started',
        currency,
        amount,
        customer,
        attribution,
        metadata: { ...metadata, idempotency_key: idempotencyKey },
      })
      .select('*')
      .single()

    if (checkoutError) throw checkoutError

    await supabase.from('checkout_events').insert({
      checkout_id: checkout.id,
      event_type: action === 'purchase' ? 'purchase_requested' : 'checkout_started',
      external_id: idempotencyKey,
      payload: { funnel_id: funnelId, product_id: productId, amount, currency, customer, attribution },
    })

    if (action !== 'purchase') return Response.json({ ok: true, checkout, next: 'purchase' }, { headers: corsHeaders })

    const baseUrl = Deno.env.get('SUPABASE_URL')!
    const gatewayResponse = await fetch(`${baseUrl}/functions/v1/gateway-orchestrator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader },
      body: JSON.stringify({
        funnel_id: funnelId,
        product_id: productId,
        amount,
        currency,
        idempotency_key: idempotencyKey,
        customer,
        metadata: { ...metadata, checkout_id: checkout.id, attribution },
      }),
    })

    const gateway = await gatewayResponse.json()
    const approved = gatewayResponse.ok && gateway?.status === 'approved'

    await supabase.from('checkout_sessions').update({
      status: approved ? 'completed' : 'failed',
      completed_at: approved ? new Date().toISOString() : null,
    }).eq('id', checkout.id)

    await supabase.from('checkout_events').insert({
      checkout_id: checkout.id,
      event_type: approved ? 'purchase_approved' : 'purchase_failed',
      external_id: idempotencyKey,
      payload: gateway,
    })

    return Response.json({ ok: approved, checkout_id: checkout.id, status: approved ? 'approved' : 'failed', gateway }, { status: approved ? 200 : 402, headers: corsHeaders })
  } catch (error) {
    console.error('checkout-engine', error)
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected error' }, { status: 500, headers: corsHeaders })
  }
}))
