import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// Per-user limit for expensive authenticated routes (AI). Same bucket RPC as the public limiter.
// Returns a 429/503 response to send back, or null when the call may proceed.
export async function limitUser(scope: string, userId: string, limit: number, windowSeconds = 60) {
  const { data, error } = await createSupabaseAdminClient().rpc('consume_funnel_event_rate_limit', {
    p_bucket_key: `user:${scope}:${userId}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; reset_at?: string } | null
  if (error || !row) return NextResponse.json({ error: 'Limite de uso indisponível. Tente de novo em instantes.' }, { status: 503 })
  if (row.allowed) return null
  const retry = row.reset_at ? Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000)) : 60
  return NextResponse.json({ error: 'Muitas requisições. Aguarde um pouco e tente de novo.' }, { status: 429, headers: { 'Retry-After': String(retry) } })
}
