import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

type RateLimitRow = {
  allowed?: boolean
  remaining?: number
  reset_at?: string
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function clientAddress(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded
    || request.headers.get('x-real-ip')?.trim()
    || request.headers.get('cf-connecting-ip')?.trim()
    || 'unknown'
}

export async function consumePublicRateLimit(
  admin: SupabaseClient,
  request: Request,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds = 60,
) {
  const normalizedScope = scope.replace(/[^a-z0-9:_-]/gi, '-').slice(0, 80)
  const fingerprint = hash(`${clientAddress(request)}|${subject}`)
  const bucketKey = `public:${normalizedScope}:${fingerprint}`

  const { data, error } = await admin.rpc('consume_funnel_event_rate_limit', {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })

  if (error) {
    console.error('[ALTHEA-PUBLIC-RATE-LIMIT]', {
      scope: normalizedScope,
      code: error.code,
      message: error.message,
    })
    return { allowed: false, unavailable: true, remaining: 0, resetAt: null as string | null }
  }

  const row = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null
  if (!row) return { allowed: false, unavailable: true, remaining: 0, resetAt: null as string | null }

  return {
    allowed: row.allowed === true,
    unavailable: false,
    remaining: Number.isFinite(Number(row.remaining)) ? Number(row.remaining) : 0,
    resetAt: typeof row.reset_at === 'string' ? row.reset_at : null,
  }
}

export function retryAfterSeconds(resetAt: string | null) {
  if (!resetAt) return '60'
  const ms = new Date(resetAt).getTime() - Date.now()
  return String(Math.max(1, Math.ceil(ms / 1000)))
}
