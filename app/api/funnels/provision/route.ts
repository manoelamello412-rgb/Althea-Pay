import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'funnel'
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const url = typeof body?.url === 'string' ? body.url.trim() : null
    const connectionType = typeof body?.connection_type === 'string' ? body.connection_type.trim() : 'script'
    if (!name) return json({ error: 'name is required' }, 400)
    if (name.length > 120) return json({ error: 'name is too long' }, 400)
    if (url && url.length > 2048) return json({ error: 'url is too long' }, 400)

    const funnelId = `funnel_${slug(name)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const ingestionToken = `alt_fnl_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
    const tokenHash = await sha256(ingestionToken)

    const funnel = await supabase.from('funnels').insert({
      id: funnelId,
      nome: name,
      url,
      endpoint: '/functions/v1/funnel-events',
      status: 'active',
      user_id: user.id,
    }).select('id,nome,url,endpoint,status,created_at').single()
    if (funnel.error) return json({ error: funnel.error.message }, 400)

    const connection = await supabase.from('funnel_connections').insert({
      user_id: user.id,
      funnel_id: funnelId,
      connection_type: connectionType || 'script',
      status: 'active',
      health_status: 'unknown',
      config: { protocol_version: '2026-09', event_endpoint: '/functions/v1/funnel-events' },
      connected_at: new Date().toISOString(),
    }).select('id,funnel_id,connection_type,status,health_status,connected_at').single()
    if (connection.error) {
      await supabase.from('funnels').delete().eq('id', funnelId).eq('user_id', user.id)
      return json({ error: connection.error.message }, 400)
    }

    const token = await supabase.from('funnel_ingestion_tokens').insert({
      user_id: user.id,
      funnel_id: funnelId,
      token_prefix: ingestionToken.slice(0, 14),
      token_hash: tokenHash,
      enabled: true,
    }).select('id,funnel_id,token_prefix,enabled,created_at').single()
    if (token.error) {
      await supabase.from('funnel_connections').delete().eq('id', connection.data.id).eq('user_id', user.id)
      await supabase.from('funnels').delete().eq('id', funnelId).eq('user_id', user.id)
      return json({ error: token.error.message }, 400)
    }

    return json({
      funnel: funnel.data,
      connection: connection.data,
      ingestion: {
        id: token.data.id,
        token_prefix: token.data.token_prefix,
        token: ingestionToken,
        endpoint: `${new URL(request.url).origin}/api/funnel/events`,
        event_endpoint: `${new URL(request.url).origin}/functions/v1/funnel-events`,
      },
      warning: 'Store the ingestion token securely. It is returned only during provisioning.',
    }, 201)
  } catch {
    return json({ error: 'internal_error' }, 500)
  }
}
