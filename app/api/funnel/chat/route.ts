import { NextRequest, NextResponse } from 'next/server'
import { getSupabasePublicConfig } from '@/lib/supabase/public-config'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { consumePublicRateLimit, retryAfterSeconds } from '@/lib/security/public-rate-limit'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

function isEnabled(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return true
  return (config as Record<string, unknown>).chat_enabled !== false
}

function limited(rate: Awaited<ReturnType<typeof consumePublicRateLimit>>) {
  if (rate.unavailable) {
    return NextResponse.json({ error: 'chat_rate_limit_unavailable' }, { status: 503, headers: cors })
  }
  return NextResponse.json(
    { error: 'rate_limited' },
    { status: 429, headers: { ...cors, 'Retry-After': retryAfterSeconds(rate.resetAt) } },
  )
}

async function resolveFunnelChat(funnelId: string) {
  const admin = createSupabaseAdminClient()
  const { data: funnel, error: funnelError } = await admin
    .from('funnels')
    .select('id,user_id,status,deleted_at')
    .eq('id', funnelId)
    .is('deleted_at', null)
    .maybeSingle()

  if (funnelError) return { error: 'chat_configuration_unavailable' as const, status: 503 }
  if (!funnel) return { error: 'funnel_not_available' as const, status: 404 }

  const funnelStatus = String(funnel.status ?? 'active').toLowerCase()
  if (!['active', 'published', 'live'].includes(funnelStatus)) {
    return { error: 'funnel_not_available' as const, status: 404 }
  }

  const { data: connection, error: connectionError } = await admin
    .from('funnel_connections')
    .select('config')
    .eq('funnel_id', funnelId)
    .eq('user_id', funnel.user_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (connectionError) return { error: 'chat_configuration_unavailable' as const, status: 503 }
  return { funnel, enabled: isEnabled(connection?.config) }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? ''
  const funnelId = req.nextUrl.searchParams.get('funnel_id')?.trim() ?? ''
  const admin = createSupabaseAdminClient()

  if (funnelId) {
    if (funnelId.length > 255) return NextResponse.json({ error: 'invalid_funnel_id' }, { status: 400, headers: cors })

    const rate = await consumePublicRateLimit(admin, req, 'chat-config', funnelId, 120, 60)
    if (!rate.allowed) return limited(rate)

    try {
      const resolved = await resolveFunnelChat(funnelId)
      if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status, headers: cors })
      return NextResponse.json({ enabled: resolved.enabled }, { headers: { ...cors, 'Cache-Control': 'no-store' } })
    } catch {
      return NextResponse.json({ error: 'chat_configuration_unavailable' }, { status: 503, headers: cors })
    }
  }

  if (!token || token.length < 32 || token.length > 128) {
    return NextResponse.json({ error: 'conversation_token_required' }, { status: 400, headers: cors })
  }

  const rate = await consumePublicRateLimit(admin, req, 'chat-read', token, 60, 60)
  if (!rate.allowed) return limited(rate)

  try {
    const { data, error } = await admin.rpc('crm_public_conversation', { p_token: token })
    if (error) return NextResponse.json({ error: 'conversation_unavailable' }, { status: 503, headers: cors })
    const result = data as { error?: string }
    if (result?.error === 'not_found') return NextResponse.json({ error: 'conversation_not_found' }, { status: 404, headers: cors })
    if (result?.error) return NextResponse.json(result, { status: 400, headers: cors })
    return NextResponse.json(data, { headers: { ...cors, 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'conversation_unavailable' }, { status: 503, headers: cors })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    if (new TextEncoder().encode(body).byteLength > 100_000) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: cors })
    }

    const parsed = JSON.parse(body) as Record<string, unknown>
    const token = typeof parsed.conversation_token === 'string' ? parsed.conversation_token.trim() : ''
    const admin = createSupabaseAdminClient()

    if (parsed.event_type === 'chat_message' && token) {
      if (token.length < 32 || token.length > 128) {
        return NextResponse.json({ error: 'invalid_token' }, { status: 400, headers: cors })
      }
      const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
      if (!message || message.length > 4000) return NextResponse.json({ error: 'invalid_message' }, { status: 400, headers: cors })

      const rate = await consumePublicRateLimit(admin, req, 'chat-message', token, 30, 60)
      if (!rate.allowed) return limited(rate)

      const { data, error } = await admin.rpc('crm_public_message', { p_token: token, p_body: message })
      if (error) return NextResponse.json({ error: 'message_unavailable' }, { status: 503, headers: cors })
      const result = data as { error?: string }
      if (result?.error) return NextResponse.json(result, { status: result.error === 'not_found' ? 404 : 400, headers: cors })
      return NextResponse.json(data, { status: 202, headers: cors })
    }

    if (parsed.event_type !== 'chat_started') {
      return NextResponse.json({ error: 'invalid_event_type' }, { status: 400, headers: cors })
    }

    const funnelId = typeof parsed.funnel_id === 'string' ? parsed.funnel_id.trim() : ''
    if (!funnelId || funnelId.length > 255) return NextResponse.json({ error: 'funnel_id_required' }, { status: 400, headers: cors })

    const rate = await consumePublicRateLimit(admin, req, 'chat-start', funnelId, 10, 60)
    if (!rate.allowed) return limited(rate)

    const resolved = await resolveFunnelChat(funnelId)
    if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status, headers: cors })
    if (!resolved.enabled) return NextResponse.json({ error: 'chat_disabled' }, { status: 403, headers: cors })

    const internalSecret = process.env.ALTHEA_INTERNAL_SECRET?.trim() ?? ''
    if (!internalSecret) return NextResponse.json({ error: 'chat_server_not_configured' }, { status: 503, headers: cors })

    const { url } = getSupabasePublicConfig()
    const upstreamPayload = { ...parsed, funnel_id: funnelId, user_id: resolved.funnel.user_id }
    const response = await fetch(`${url}/functions/v1/funnel-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
      body: JSON.stringify(upstreamPayload),
      cache: 'no-store',
    })
    const responseBody = await response.text()
    return new NextResponse(responseBody, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') || 'application/json', ...cors },
    })
  } catch {
    return NextResponse.json({ error: 'chat_upstream_unavailable' }, { status: 502, headers: cors })
  }
}
