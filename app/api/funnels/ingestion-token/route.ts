import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const body = await request.json().catch(() => ({}))
    const funnelId = typeof body?.funnel_id === 'string' ? body.funnel_id.trim() : ''
    if (!funnelId) return json({ error: 'funnel_id_required' }, 400)

    const { data: funnel, error: funnelError } = await supabase
      .from('funnels')
      .select('id,endpoint,status,organization_id')
      .eq('id', funnelId)
      .is('deleted_at', null)
      .maybeSingle()

    if (funnelError) return json({ error: funnelError.message }, 400)
    if (!funnel) return json({ error: 'funnel_not_found' }, 404)

    const { error: revokeError } = await supabase
      .from('funnel_ingestion_tokens')
      .update({ enabled: false, revoked_at: new Date().toISOString() })
      .eq('funnel_id', funnelId)
      .eq('organization_id', funnel.organization_id)
      .eq('enabled', true)
    if (revokeError) return json({ error: revokeError.message }, 400)

    const token = `alt_fnl_${randomBytes(48).toString('hex')}`
    const tokenHash = hashToken(token)
    const { data: created, error: createError } = await supabase
      .from('funnel_ingestion_tokens')
      .insert({
        user_id: user.id,
        funnel_id: funnelId,
        organization_id: funnel.organization_id,
        token_prefix: token.slice(0, 14),
        token_hash: tokenHash,
        enabled: true,
      })
      .select('id,token_prefix,enabled,created_at')
      .single()

    if (createError) return json({ error: createError.message }, 400)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
    const origin = new URL(request.url).origin
    return json({
      ingestion: {
        id: created.id,
        token_prefix: created.token_prefix,
        token,
        endpoint: funnel.endpoint,
        secret_once: true,
      },
      connector: {
        protocol_version: '1',
        event_endpoint: funnel.endpoint,
        client_token_endpoint: supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/funnel-client-token` : null,
        browser_sdk_url: `${origin}/althea-funnel-connector.js`,
      },
    }, 201)
  } catch {
    return json({ error: 'internal_error' }, 500)
  }
}
