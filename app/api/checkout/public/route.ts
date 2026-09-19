import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { consumePublicRateLimit, retryAfterSeconds } from '@/lib/security/public-rate-limit'

type JsonObject = Record<string, unknown>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function rpcStatus(message: string) {
  if (/CHECKOUT_(NOT_AVAILABLE|OFFER_NOT_FOUND|PRODUCT_NOT_FOUND)/i.test(message)) return 404
  if (/INVALID_|OFFER_REQUIRED|IDEMPOTENCY_KEY_REQUIRED/i.test(message)) return 400
  return 503
}

function rateLimitResponse(rate: Awaited<ReturnType<typeof consumePublicRateLimit>>) {
  if (rate.unavailable) return NextResponse.json({ ok: false, error: 'public_rate_limit_unavailable' }, { status: 503 })
  return NextResponse.json(
    { ok: false, error: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': retryAfterSeconds(rate.resetAt) } },
  )
}

export async function GET(request: NextRequest) {
  const funnelId = text(request.nextUrl.searchParams.get('funnel_id'))
  const offerId = text(request.nextUrl.searchParams.get('offer_id'))

  if (!funnelId || funnelId.length > 200) {
    return NextResponse.json({ ok: false, error: 'invalid_funnel_id' }, { status: 400 })
  }
  if (offerId && !uuid.test(offerId)) {
    return NextResponse.json({ ok: false, error: 'invalid_offer_id' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const rate = await consumePublicRateLimit(admin, request, 'checkout-context', funnelId, 120, 60)
  if (!rate.allowed) return rateLimitResponse(rate)

  const { data, error } = await admin.rpc('get_public_checkout_context', {
    p_funnel_id: funnelId,
    p_offer_id: offerId || null,
  })

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'checkout_unavailable' },
      { status: rpcStatus(error.message) },
    )
  }

  return NextResponse.json(
    { ok: true, context: data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > 64_000) {
    return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 })
  }

  let body: JsonObject
  try {
    const parsed = JSON.parse(raw)
    if (!object(parsed)) throw new Error('invalid_json')
    body = parsed
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const funnelId = text(body.funnel_id)
  const offerId = text(body.offer_id)
  const idempotencyKey = text(body.idempotency_key)
  const customer = object(body.customer) ? body.customer : {}
  const attribution = object(body.attribution) ? body.attribution : {}
  const metadata = object(body.metadata) ? body.metadata : {}

  if (!funnelId || funnelId.length > 200 || !uuid.test(offerId)) {
    return NextResponse.json({ ok: false, error: 'invalid_checkout_request' }, { status: 400 })
  }
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    return NextResponse.json({ ok: false, error: 'invalid_idempotency_key' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const rate = await consumePublicRateLimit(admin, request, 'checkout-create', funnelId, 30, 60)
  if (!rate.allowed) return rateLimitResponse(rate)

  const { data, error } = await admin.rpc('create_public_checkout_session', {
    p_funnel_id: funnelId,
    p_offer_id: offerId,
    p_customer: customer,
    p_attribution: attribution,
    p_metadata: metadata,
    p_idempotency_key: idempotencyKey,
  })

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'checkout_create_failed' },
      { status: rpcStatus(error.message) },
    )
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
