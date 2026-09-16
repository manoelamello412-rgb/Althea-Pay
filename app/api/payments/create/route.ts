import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const PAYMENT_METHODS = new Set(['pix', 'card', 'boleto', 'wallet', 'bank_transfer', 'other'])

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const checkoutSessionId = typeof body?.checkout_session_id === 'string' ? body.checkout_session_id.trim() : ''
    const paymentMethod = typeof body?.payment_method === 'string' ? body.payment_method.trim().toLowerCase() : ''
    const idempotencyKey = typeof body?.idempotency_key === 'string' ? body.idempotency_key.trim() : ''

    if (!/^[0-9a-f-]{36}$/i.test(checkoutSessionId) || !PAYMENT_METHODS.has(paymentMethod) || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return NextResponse.json({ ok: false, code: 'INVALID_PAYMENT_REQUEST' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: session, error: sessionError } = await admin
      .from('checkout_sessions')
      .select('id,user_id,organization_id,funnel_id,product_id,amount,currency,customer,metadata,status')
      .eq('id', checkoutSessionId)
      .maybeSingle()

    if (sessionError || !session) return NextResponse.json({ ok: false, code: 'CHECKOUT_SESSION_NOT_FOUND' }, { status: 404 })
    if (session.status !== 'started') return NextResponse.json({ ok: false, code: 'CHECKOUT_NOT_PAYABLE' }, { status: 409 })

    const metadata = {
      source: 'public_checkout',
      payment_method: paymentMethod,
      checkout_session_id: session.id,
    }

    const { data: transaction, error } = await admin.rpc('create_gateway_transaction', {
      p_user_id: session.user_id,
      p_organization_id: session.organization_id,
      p_funnel_id: session.funnel_id,
      p_product_id: session.product_id,
      p_amount: session.amount,
      p_currency: session.currency,
      p_customer: session.customer,
      p_metadata: metadata,
      p_idempotency_key: `payment:${idempotencyKey}`,
    })

    if (error || !transaction) {
      console.error('[ALTHEA-PAYMENTS-CREATE]', error)
      return NextResponse.json({ ok: false, code: 'PAYMENT_CREATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      transaction: {
        id: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
      },
      next: 'gateway_execution',
    })
  } catch (error) {
    console.error('[ALTHEA-PAYMENTS-CREATE]', error)
    return NextResponse.json({ ok: false, code: 'PAYMENT_CREATE_FAILED' }, { status: 500 })
  }
}
