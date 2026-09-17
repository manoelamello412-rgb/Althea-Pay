import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type JsonObject = Record<string, unknown>
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const path = (root: unknown, key: string): unknown => key.split('.').filter(Boolean).reduce<unknown>((value, part) => obj(value)[part], root)
const first = (root: unknown, paths: string[]) => { for (const key of paths) { const value = path(root, key); if (typeof value === 'string' || typeof value === 'number') return String(value) } return '' }

function normalizeAction(payload: JsonObject, method: string) {
  const root = obj(payload.response ?? payload.data ?? payload)
  const qr = first(root, ['qr_code','qrCode','pix.qr_code','pix.qrCode','payment.qr_code','payment.qrCode','data.qr_code','data.qrCode','qr'])
  const copyPaste = first(root, ['copy_paste','copyPaste','pix.copy_paste','pix.copyPaste','payment.copy_paste','payment.copyPaste','data.copy_paste','data.copyPaste','brcode','emv'])
  const url = first(root, ['checkout_url','checkoutUrl','payment_url','paymentUrl','redirect_url','redirectUrl','url','data.checkout_url','data.checkoutUrl','data.payment_url','data.paymentUrl'])
  const expiresAt = first(root, ['expires_at','expiresAt','payment.expires_at','payment.expiresAt','data.expires_at','data.expiresAt'])
  const explicitType = first(root, ['action_type','actionType','next_action.type','nextAction.type']).toLowerCase()
  const type = explicitType || (qr || copyPaste ? 'pix' : url ? 'redirect' : method === 'card' ? 'card' : 'none')
  if (type === 'none' && !qr && !copyPaste && !url) return null
  return { type, qr_code: qr || null, copy_paste: copyPaste || null, url: url || null, expires_at: expiresAt || null, payment_method: method }
}

function normalizeTransactionStatus(providerStatus: string, currentStatus: string) {
  const status = providerStatus.toLowerCase()
  if (status === 'approved') return 'approved'
  if (status === 'declined') return 'failed'
  if (status === 'pending') return 'pending'
  return currentStatus.toLowerCase()
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as JsonObject
    const transactionId = text(body.transaction_id)
    const checkoutSessionId = text(body.checkout_session_id)
    const idempotencyKey = text(body.idempotency_key)
    if (!/^[0-9a-f-]{36}$/i.test(transactionId) || !/^[0-9a-f-]{36}$/i.test(checkoutSessionId) || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return NextResponse.json({ ok: false, code: 'INVALID_PAYMENT_ACTION_REQUEST' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()
    const { data: session, error: sessionError } = await admin
      .from('checkout_sessions')
      .select('id,user_id,organization_id,idempotency_key')
      .eq('id', checkoutSessionId)
      .maybeSingle()
    if (sessionError || !session || text(session.idempotency_key) !== idempotencyKey) {
      return NextResponse.json({ ok: false, code: 'CHECKOUT_SESSION_NOT_FOUND' }, { status: 404 })
    }

    const { data: tx, error: txError } = await admin
      .from('gateway_transactions')
      .select('id,user_id,organization_id,gateway_id,external_id,amount,currency,metadata,status,version')
      .eq('id', transactionId)
      .eq('user_id', session.user_id)
      .eq('organization_id', session.organization_id)
      .maybeSingle()
    if (txError || !tx || text(tx.metadata?.checkout_session_id) !== checkoutSessionId) {
      return NextResponse.json({ ok: false, code: 'TRANSACTION_NOT_FOUND' }, { status: 404 })
    }

    const currentStatus = text(tx.status).toLowerCase()
    if (!tx.gateway_id) return NextResponse.json({ ok: true, action: null, status: currentStatus })
    const externalId = text(tx.external_id) || text(tx.metadata?.external_transaction_id)
    if (!externalId) return NextResponse.json({ ok: true, action: null, status: currentStatus })

    const { data: gateway } = await admin
      .from('gateways')
      .select('id,environment,status')
      .eq('id', tx.gateway_id)
      .eq('organization_id', session.organization_id)
      .maybeSingle()
    if (!gateway || !['active','connected','degraded'].includes(text(gateway.status).toLowerCase())) {
      return NextResponse.json({ ok: true, action: null, status: currentStatus })
    }

    const secret = text(process.env.ALTHEA_INTERNAL_SECRET)
    const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)
    if (!secret || !supabaseUrl) return NextResponse.json({ ok: false, code: 'PAYMENT_PROCESSOR_NOT_CONFIGURED' }, { status: 503 })

    const response = await fetch(`${supabaseUrl.replace(/\/$/,'')}/functions/v1/gateway-provider-adapter`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-althea-internal-secret': secret,
        'x-althea-gateway-id': tx.gateway_id,
      },
      body: JSON.stringify({
        operation: 'payment_status',
        gateway_id: tx.gateway_id,
        environment: gateway.environment,
        transaction_id: tx.id,
        external_transaction_id: externalId,
        amount: tx.amount,
        currency: tx.currency,
        payment_method: { type: text(tx.metadata?.payment_method) },
        idempotency_key: `action:${tx.id}`,
      }),
      cache: 'no-store',
    })
    const result = await response.json().catch(() => ({})) as JsonObject
    if (!response.ok) return NextResponse.json({ ok: true, action: null, status: currentStatus })

    const providerStatus = text(result.status).toLowerCase()
    let status = normalizeTransactionStatus(providerStatus, currentStatus)
    if (status !== currentStatus && ['approved','failed','pending'].includes(status)) {
      const transition = await admin.rpc('transition_gateway_transaction_status', {
        p_transaction_id: tx.id,
        p_user_id: session.user_id,
        p_next_status: status,
        p_failure_code: status === 'failed' ? text(result.failure_code ?? result.error) || 'GATEWAY_DECLINED' : null,
        p_external_id: externalId,
        p_expected_version: Number(tx.version),
      })
      if (!transition.error && transition.data) {
        const row = Array.isArray(transition.data) ? transition.data[0] : transition.data
        status = text(row?.status) || status
      }
    }

    return NextResponse.json({
      ok: true,
      action: normalizeAction(result, text(tx.metadata?.payment_method)),
      status,
      provider_status: text(result.provider_status) || null,
    })
  } catch (error) {
    console.error('[ALTHEA-PAYMENT-ACTION]', error)
    return NextResponse.json({ ok: false, code: 'PAYMENT_ACTION_UNAVAILABLE' }, { status: 500 })
  }
}
