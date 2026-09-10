import { NextRequest, NextResponse } from 'next/server'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/public-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_PUBLISHABLE_KEY
const SUPABASE_URL_VALUE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL
const TARGET = `${SUPABASE_URL_VALUE}/functions/v1/funnel-events`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-funnel-event-token',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control': 'no-store',
}

const MAX_BODY_BYTES = 100_000
const MAX_STRING = 4_000
const ALLOWED_EVENTS = new Set([
  'page_view',
  'quiz_started',
  'quiz_answered',
  'checkout_started',
  'checkout_abandoned',
  'payment_created',
  'payment_failed',
  'payment_approved',
  'chat_started',
  'chat_message',
])

type JsonObject = Record<string, unknown>

function json(body: JsonObject, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, maxLength = MAX_STRING): string | null {
  if (typeof value !== 'string') return null
  const valueTrimmed = value.trim()
  if (!valueTrimmed || valueTrimmed.length > maxLength) return null
  return valueTrimmed
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function sanitizeEvent(raw: JsonObject): JsonObject | null {
  const eventType = nonEmptyString(raw.event_type, 80)
  if (!eventType || !ALLOWED_EVENTS.has(eventType)) return null

  const funnelId = nonEmptyString(raw.funnel_id, 300)
  if (!funnelId) return null

  const eventId = nonEmptyString(raw.event_id, 300) ?? nonEmptyString(raw.external_id, 300)
  const currentStep = nonEmptyString(raw.current_step, 160)
  const gatewayError = nonEmptyString(raw.gateway_error, MAX_STRING)
  const message = nonEmptyString(raw.message, MAX_STRING)

  const customer = isObject(raw.customer) ? raw.customer : undefined
  const answers = isObject(raw.answers) ? raw.answers : undefined

  const sanitized: JsonObject = {
    event_type: eventType,
    funnel_id: funnelId,
    ...(eventId ? { event_id: eventId } : {}),
    ...(currentStep ? { current_step: currentStep } : {}),
    ...(gatewayError ? { gateway_error: gatewayError } : {}),
    ...(message ? { message } : {}),
    ...(customer ? { customer } : {}),
    ...(answers ? { answers } : {}),
  }

  for (const key of ['product_id', 'transaction_id', 'checkout_id', 'session_id', 'page_url']) {
    const value = nonEmptyString(raw[key], 500)
    if (value) sanitized[key] = value
  }

  if (typeof raw.occurred_at === 'string') {
    const occurredAt = new Date(raw.occurred_at)
    if (!Number.isNaN(occurredAt.getTime())) sanitized.occurred_at = occurredAt.toISOString()
  }

  return sanitized
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('x-funnel-event-token')?.trim() ?? ''
    if (token.length < 32 || token.length > 256) {
      return json({ success: false, error: 'funnel_event_token_required' }, 401)
    }

    const rawBody = await request.text()
    if (utf8ByteLength(rawBody) > MAX_BODY_BYTES) {
      return json({ success: false, error: 'payload_too_large' }, 413)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return json({ success: false, error: 'invalid_json' }, 400)
    }

    if (!isObject(parsed)) {
      return json({ success: false, error: 'invalid_payload' }, 400)
    }

    const event = sanitizeEvent(parsed)
    if (!event) {
      return json({ success: false, error: 'invalid_event_contract' }, 400)
    }

    const upstream = await fetch(TARGET, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_KEY,
        'x-funnel-event-token': token,
      },
      body: JSON.stringify(event),
      cache: 'no-store',
    })

    const responseText = await upstream.text()
    let responseBody: unknown = { success: upstream.ok }
    try {
      responseBody = JSON.parse(responseText)
    } catch {
      responseBody = { success: upstream.ok, upstream: responseText.slice(0, 2_000) }
    }

    return NextResponse.json(responseBody, {
      status: upstream.status,
      headers: CORS_HEADERS,
    })
  } catch {
    return json({ success: false, error: 'telemetry_unavailable' }, 502)
  }
}
