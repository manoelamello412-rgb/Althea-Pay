import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

type Body = {
  conversationId?: unknown
  action?: unknown
  linkType?: unknown
  idempotencyKey?: unknown
}

type Json = Record<string, unknown>

const objectOf = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

const numberValue = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? number : null
}

const json = (status: number, body: Json) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return json(401, { error: 'unauthorized' })

  let body: Body
  try {
    body = await request.json() as Body
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  const action = typeof body.action === 'string' ? body.action : ''
  const linkType = typeof body.linkType === 'string' ? body.linkType : 'payment_link'
  const requestedIdempotency = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''

  if (!uuid.test(conversationId)) return json(400, { error: 'invalid_conversation_id' })

  if (action === 'prepare') {
    const { data, error } = await supabase.rpc('crm_operator_prepare_checkout_recovery', {
      p_conversation_id: conversationId,
    })
    if (error) return json(409, { error: error.message })
    return json(200, { recovery: objectOf(data) })
  }

  if (action === 'payment_link') {
    if (!['pix', 'card', 'payment_link'].includes(linkType)) return json(400, { error: 'invalid_link_type' })

    const { data: recoveryData, error: recoveryError } = await supabase.rpc('crm_operator_prepare_checkout_recovery', {
      p_conversation_id: conversationId,
    })
    if (recoveryError) return json(409, { error: recoveryError.message })

    const recovery = objectOf(recoveryData)
    const checkout = objectOf(recovery.checkout)
    const funnel = objectOf(recovery.funnel)

    const funnelId = text(recovery.funnel_id) ?? text(checkout.funnel_id) ?? text(funnel.id)
    const amount = numberValue(recovery.amount) ?? numberValue(recovery.value) ?? numberValue(checkout.amount) ?? numberValue(checkout.value)
    const currencyCandidate = text(recovery.currency) ?? text(checkout.currency) ?? 'BRL'
    const currency = /^[A-Z]{3}$/.test(currencyCandidate) ? currencyCandidate : 'BRL'

    if (recovery.checkout_status === 'pago' || recovery.status === 'completed' || checkout.status === 'completed') {
      return json(409, { error: 'checkout_already_paid' })
    }

    if (!funnelId || !amount) return json(422, { error: 'missing_checkout_context' })

    const suppliedKey = requestedIdempotency.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 180)
    const idempotencyKey = suppliedKey || `crm-recovery:${conversationId}:${linkType}`

    const { data: preparedData, error: prepareError } = await supabase.rpc('prepare_gateway_payment_link', {
      p_user_id: user.id,
      p_funnel_id: funnelId,
      p_amount: amount,
      p_currency: currency,
      p_link_type: linkType,
      p_idempotency_key: idempotencyKey,
    })

    if (prepareError) return json(409, { error: prepareError.message })

    const prepared = objectOf(preparedData)
    const linkId = text(prepared.link_id)
    const gatewayId = text(prepared.gateway_id)

    if (!linkId || !uuid.test(linkId) || !gatewayId) {
      return json(502, { error: 'invalid_gateway_preparation' })
    }

    // Preparation and execution are deliberately separated. The command is
    // durable and idempotent; a trusted service worker performs provider I/O.
    const { data: commandData, error: commandError } = await supabase.rpc('enqueue_gateway_payment_link_execution', {
      p_user_id: user.id,
      p_payment_link_id: linkId,
      p_gateway_id: gatewayId,
      p_idempotency_key: idempotencyKey,
      p_request_payload: {
        source: 'crm_checkout_recovery',
        conversation_id: conversationId,
        checkout_id: text(recovery.checkout_id) ?? text(checkout.id),
        funnel_id: funnelId,
        link_type: linkType,
        amount,
        currency,
      },
    })

    if (commandError) return json(409, { error: commandError.message })

    return json(202, {
      paymentLink: prepared,
      execution: objectOf(commandData),
      recovery: {
        checkoutId: text(recovery.checkout_id) ?? text(checkout.id),
        funnelId,
        amount,
        currency,
      },
    })
  }

  return json(400, { error: 'unsupported_action' })
}
