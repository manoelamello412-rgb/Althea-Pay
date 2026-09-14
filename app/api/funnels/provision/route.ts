import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const FUNNEL_TYPES = new Set(['sales', 'lead_capture', 'launch', 'product', 'upsell_downsell', 'subscription', 'custom'])

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

function normalizeUrl(value: string | null) {
  const clean = value?.trim() ?? ''
  if (!clean) return null
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : null
    const connectionType = typeof body?.connection_type === 'string' ? body.connection_type.trim() : 'script'
    const funnelType = typeof body?.funnel_type === 'string' ? body.funnel_type.trim() : 'custom'

    if (!name) return json({ error: 'name is required' }, 400)
    if (name.length > 120) return json({ error: 'name is too long' }, 400)
    if (rawUrl && rawUrl.length > 2048) return json({ error: 'url is too long' }, 400)
    if (connectionType !== 'script' && connectionType !== 'webhook') return json({ error: 'invalid connection_type' }, 400)
    if (!FUNNEL_TYPES.has(funnelType)) return json({ error: 'invalid funnel_type' }, 400)

    const url = normalizeUrl(rawUrl)
    if (url) {
      try { new URL(url) } catch { return json({ error: 'invalid url' }, 400) }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    if (!supabaseUrl) return json({ error: 'Supabase URL is not configured for this environment.' }, 500)
    const eventEndpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/funnel-events`

    const { data, error } = await supabase.rpc('provision_funnel_atomic', {
      p_name: name,
      p_url: url,
      p_connection_type: connectionType,
      p_funnel_type: funnelType,
      p_event_endpoint: eventEndpoint,
    })
    if (error) {
      const status = error.message === 'unauthorized' ? 401 : error.message.startsWith('invalid ') || error.message.endsWith('is required') || error.message.endsWith('is too long') ? 400 : 500
      return json({ error: status === 500 ? 'internal_error' : error.message }, status)
    }

    return json(data, 201)
  } catch (cause) {
    console.error('[funnels/provision]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}
