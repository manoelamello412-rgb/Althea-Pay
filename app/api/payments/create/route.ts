import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

const PAYMENT_METHODS = new Set(['pix', 'card', 'boleto', 'wallet', 'bank_transfer', 'other'])
const TERMINAL_TRANSACTION_STATES = new Set(['approved', 'failed', 'refunded', 'chargeback'])
const ADAPTER_TIMEOUT_MS = 20_000

type JsonObject = Record<string, unknown>

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function safeErrorCode(error: { message?: string } | null | undefined): string { const message = text(error?.message); return /^[a-z0-9_:-]{3,80}$/i.test(message) ? message.toUpperCase() : 'PAYMENT_PROCESSING_FAILED' }

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const checkoutSessionId = text(body?.checkout_session_id)
    const paymentMethod = text(body?.payment_method).toLowerCase()
    const idempotencyKey = text(body?.idempotency_key)
    const paymentDetails = body?.payment_details
    if (!/^[0-9a-f-]{36}$/i.test(checkoutSessionId) || !PAYMENT_METHODS.has(paymentMethod) || idempotencyKey.length < 16 || idempotencyKey.length > 128) return NextResponse.json({ ok: false, code: 'INVALID_PAYMENT_REQUEST' }, { status: 400 })

    const admin = createSupabaseAdminClient()
    const { data: session, error: sessionError } = await admin.from('checkout_sessions').select('id,user_id,organization_id,funnel_id,product_id,amount,currency,customer,metadata,status').eq('id', checkoutSessionId).maybeSingle()
    if (sessionError || !session) return NextResponse.json({ ok: false, code: 'CHECKOUT_SESSION_NOT_FOUND' }, { status: 404 })
    if (session.status !== 'started') return NextResponse.json({ ok: false, code: 'CHECKOUT_NOT_PAYABLE' }, { status: 409 })

    const metadata: JsonObject = { source: 'public_checkout', payment_method: paymentMethod, checkout_session_id: session.id }
    const { data: transaction, error: transactionError } = await admin.rpc('create_gateway_transaction', {
      p_user_id: session.user_id, p_organization_id: session.organization_id, p_funnel_id: session.funnel_id, p_product_id: session.product_id,
      p_amount: session.amount, p_currency: session.currency, p_customer: session.customer, p_metadata: metadata, p_idempotency_key: `payment:${idempotencyKey}`,
    })
    if (transactionError || !transaction) { console.error('[ALTHEA-PAYMENTS-CREATE]', transactionError); return NextResponse.json({ ok: false, code: safeErrorCode(transactionError) }, { status: 500 }) }

    if (TERMINAL_TRANSACTION_STATES.has(text(transaction.status))) return NextResponse.json({ ok: true, transaction: { id: transaction.id, status: transaction.status, amount: transaction.amount, currency: transaction.currency, gateway_id: transaction.gateway_id }, next: 'complete' })
    if (text(transaction.status) === 'pending') return NextResponse.json({ ok: true, transaction: { id: transaction.id, status: transaction.status, amount: transaction.amount, currency: transaction.currency, gateway_id: transaction.gateway_id }, next: 'awaiting_gateway' })

    const { data: route, error: routeError } = await admin.rpc('select_gateway_for_funnel', { p_user_id: session.user_id, p_funnel_id: session.funnel_id, p_product_id: session.product_id })
    const selectedRoute = Array.isArray(route) ? route[0] : route
    if (routeError || !selectedRoute?.gateway_id) { console.error('[ALTHEA-PAYMENTS-ROUTE]', routeError); return NextResponse.json({ ok: false, code: 'NO_OPERATIONAL_GATEWAY_ROUTE' }, { status: 409 }) }

    const expectedVersion = Number(transaction.version)
    const { data: boundTransaction, error: bindError } = await admin.rpc('bind_gateway_transaction_gateway', { p_transaction_id: transaction.id, p_user_id: session.user_id, p_gateway_id: selectedRoute.gateway_id, p_expected_version: Number.isFinite(expectedVersion) ? expectedVersion : null })
    if (bindError || !boundTransaction) { console.error('[ALTHEA-PAYMENTS-BIND]', bindError); return NextResponse.json({ ok: false, code: 'GATEWAY_BIND_FAILED' }, { status: 409 }) }

    const { data: pendingTransaction, error: pendingError } = await admin.rpc('transition_gateway_transaction_status', {
      p_transaction_id: boundTransaction.id, p_user_id: session.user_id, p_next_status: 'pending', p_failure_code: null, p_external_id: null, p_expected_version: Number(boundTransaction.version),
    })
    if (pendingError || !pendingTransaction) { console.error('[ALTHEA-PAYMENTS-PENDING]', pendingError); return NextResponse.json({ ok: false, code: 'PAYMENT_STATE_UPDATE_FAILED' }, { status: 500 }) }

    const internalSecret = text(process.env.ALTHEA_INTERNAL_SECRET)
    const supabaseUrl = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)
    if (!internalSecret || !supabaseUrl) { console.error('[ALTHEA-PAYMENTS-CONFIG] gateway execution secret/url is not configured'); return NextResponse.json({ ok: false, code: 'PAYMENT_PROCESSOR_NOT_CONFIGURED' }, { status: 503 }) }

    const adapterPayload = {
      operation: 'create_payment', gateway_id: selectedRoute.gateway_id, environment: 'production', transaction_id: pendingTransaction.id,
      amount: pendingTransaction.amount, currency: pendingTransaction.currency, payment_method: { type: paymentMethod, details: paymentDetails ?? {} },
      customer: session.customer ?? {}, metadata: { ...metadata, ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}) },
      idempotency_key: `payment:${idempotencyKey}`, funnel_id: session.funnel_id, product_id: session.product_id,
    }

    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), ADAPTER_TIMEOUT_MS)
    let adapterResponse: Response
    try {
      adapterResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/gateway-provider-adapter`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-althea-internal-secret': internalSecret, 'x-althea-gateway-id': selectedRoute.gateway_id },
        body: JSON.stringify(adapterPayload), signal: controller.signal, cache: 'no-store',
      })
    } catch (error) {
      clearTimeout(timeout); console.error('[ALTHEA-PAYMENTS-ADAPTER]', error)
      const { error: attemptError } = await admin.rpc('allocate_and_insert_gateway_payment_attempt', {
        p_user_id: session.user_id, p_transaction_id: pendingTransaction.id, p_gateway_id: selectedRoute.gateway_id, p_gateway_name: text(selectedRoute.gateway_id), p_idempotency_key: `attempt:${idempotencyKey}`,
        p_status: 'unknown', p_failure_class: 'timeout', p_external_transaction_id: null, p_routing_rule_id: selectedRoute.route_id ?? null, p_routing_policy_id: null, p_routing_policy_version: null,
        p_decision_reason: selectedRoute.decision_reason ?? 'configured_route', p_provider_request_id: null, p_duration_ms: ADAPTER_TIMEOUT_MS, p_sale_id: null, p_product_id: session.product_id,
      })
      if (attemptError) console.error('[ALTHEA-PAYMENTS-ATTEMPT]', attemptError)
      return NextResponse.json({ ok: false, code: 'GATEWAY_TIMEOUT', transaction_id: pendingTransaction.id }, { status: 504 })
    } finally { clearTimeout(timeout) }

    const adapterPayloadResult = await adapterResponse.json().catch(() => ({})) as JsonObject
    const providerExternalId = text(adapterPayloadResult.external_id ?? adapterPayloadResult.id)
    const providerRequestId = text(adapterPayloadResult.provider_request_id ?? adapterPayloadResult.request_id)
    const providerStatus = text(adapterPayloadResult.status).toLowerCase()
    const durationMs = Math.max(0, Math.round(Number(adapterPayloadResult.duration_ms ?? 0))) || null

    let attemptStatus: 'approved' | 'declined' | 'error' | 'pending' | 'processing' | 'unknown' = 'unknown'
    let transactionStatus: 'approved' | 'failed' | 'pending' = 'pending'
    if (adapterResponse.ok && providerStatus === 'approved') { attemptStatus = 'approved'; transactionStatus = 'approved' }
    else if (adapterResponse.ok && providerStatus === 'pending') { attemptStatus = 'pending'; transactionStatus = 'pending' }
    else if (adapterResponse.status >= 400 && adapterResponse.status < 500) { attemptStatus = 'declined'; transactionStatus = 'failed' }
    else { attemptStatus = 'unknown'; transactionStatus = 'pending' }

    const { error: attemptError } = await admin.rpc('allocate_and_insert_gateway_payment_attempt', {
      p_user_id: session.user_id, p_transaction_id: pendingTransaction.id, p_gateway_id: selectedRoute.gateway_id, p_gateway_name: text(selectedRoute.gateway_id), p_idempotency_key: `attempt:${idempotencyKey}`,
      p_status: attemptStatus, p_failure_class: attemptStatus === 'declined' ? 'declined' : attemptStatus === 'error' || attemptStatus === 'unknown' ? 'technical' : null,
      p_external_transaction_id: providerExternalId || null, p_routing_rule_id: selectedRoute.route_id ?? null, p_routing_policy_id: null, p_routing_policy_version: null,
      p_decision_reason: selectedRoute.decision_reason ?? 'configured_route', p_provider_request_id: providerRequestId || null, p_duration_ms: durationMs, p_sale_id: null, p_product_id: session.product_id,
    })
    if (attemptError) { console.error('[ALTHEA-PAYMENTS-ATTEMPT]', attemptError); return NextResponse.json({ ok: false, code: 'PAYMENT_ATTEMPT_PERSIST_FAILED', transaction_id: pendingTransaction.id }, { status: 500 }) }

    const { data: finalTransaction, error: transitionError } = await admin.rpc('transition_gateway_transaction_status', {
      p_transaction_id: pendingTransaction.id, p_user_id: session.user_id, p_next_status: transactionStatus,
      p_failure_code: attemptStatus === 'declined' || attemptStatus === 'error' || attemptStatus === 'unknown' ? text(adapterPayloadResult.failure_code ?? adapterPayloadResult.error) || 'GATEWAY_EXECUTION_PENDING_OR_FAILED' : null,
      p_external_id: providerExternalId || null, p_expected_version: Number(pendingTransaction.version),
    })
    if (transitionError || !finalTransaction) { console.error('[ALTHEA-PAYMENTS-TRANSITION]', transitionError); return NextResponse.json({ ok: false, code: 'PAYMENT_STATE_UPDATE_FAILED', transaction_id: pendingTransaction.id }, { status: 500 }) }

    return NextResponse.json({ ok: true, transaction: { id: finalTransaction.id, status: finalTransaction.status, amount: finalTransaction.amount, currency: finalTransaction.currency, gateway_id: finalTransaction.gateway_id, external_id: finalTransaction.external_id }, gateway: { id: selectedRoute.gateway_id, provider_status: adapterPayloadResult.provider_status ?? null }, next: transactionStatus === 'approved' ? 'complete' : transactionStatus === 'pending' ? 'awaiting_gateway' : 'retry_or_failover' }, { status: 200 })
  } catch (error) { console.error('[ALTHEA-PAYMENTS-CREATE]', error); return NextResponse.json({ ok: false, code: 'PAYMENT_PROCESSING_FAILED' }, { status: 500 }) }
}
