import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

type Body = {
  conversationId?: unknown
  action?: unknown
  linkType?: unknown
}

type Json = Record<string, unknown>

const objectOf = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const json = (status: number, body: Json) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

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

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return json(400, { error: 'invalid_conversation_id' })
  }

  if (action === 'prepare') {
    const { data, error } = await supabase.rpc('crm_operator_prepare_checkout_recovery', {
      p_conversation_id: conversationId,
    })
    if (error) return json(409, { error: error.message })
    return json(200, { recovery: objectOf(data) })
  }

  if (action === 'payment_link') {
    if (!['pix', 'card', 'payment_link'].includes(linkType)) return json(400, { error: 'invalid_link_type' })

    const { data: conversation, error: conversationError } = await supabase
      .from('crm_conversations')
      .select('id,funnel_id,checkout_status,metadata')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (conversationError || !conversation) return json(404, { error: 'conversation_not_found' })
    if (conversation.checkout_status === 'pago') return json(409, { error: 'checkout_already_paid' })

    const metadata = objectOf(conversation.metadata)
    const amountValue = metadata.amount
    const currencyValue = metadata.currency
    const amount = typeof amountValue === 'number' ? amountValue : typeof amountValue === 'string' ? Number(amountValue) : NaN
    const currency = typeof currencyValue === 'string' && /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : 'BRL'

    if (!conversation.funnel_id || !Number.isFinite(amount) || amount <= 0) {
      return json(422, { error: 'missing_checkout_amount_or_funnel' })
    }

    const idempotencyKey = `crm-recovery:${conversationId}:${linkType}:${crypto.randomUUID()}`
    const { data, error } = await supabase.rpc('prepare_gateway_payment_link', {
      p_user_id: user.id,
      p_funnel_id: conversation.funnel_id,
      p_amount: amount,
      p_currency: currency,
      p_link_type: linkType,
      p_idempotency_key: idempotencyKey,
    })

    if (error) return json(409, { error: error.message })
    return json(200, { paymentLink: objectOf(data) })
  }

  return json(400, { error: 'unsupported_action' })
}
