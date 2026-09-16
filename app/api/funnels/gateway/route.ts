import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)

    const body = await request.json().catch(() => ({}))
    const funnelId = typeof body?.funnel_id === 'string' ? body.funnel_id.trim() : ''
    const gatewayId = typeof body?.gateway_id === 'string' ? body.gateway_id.trim() : ''
    const makePrimary = body?.make_primary !== false
    if (!funnelId || !gatewayId) return json({ error: 'funnel_id and gateway_id are required' }, 400)

    const { data, error } = await supabase.rpc('bind_funnel_gateway', {
      p_funnel_id: funnelId,
      p_gateway_id: gatewayId,
      p_role: 'payment',
      p_priority: 1,
      p_make_primary: makePrimary,
    })
    if (error) {
      if (error.message === 'forbidden' || error.message === 'FORBIDDEN') return json({ error: 'forbidden' }, 403)
      if (/not found|mismatch|inactive|disabled/i.test(error.message)) return json({ error: error.message }, 409)
      return json({ error: 'gateway_binding_failed' }, 500)
    }
    return json({ binding: data })
  } catch (cause) {
    console.error('[funnels/gateway]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)
    const funnelId = new URL(request.url).searchParams.get('funnel_id')?.trim() ?? ''
    if (!funnelId) return json({ error: 'funnel_id is required' }, 400)

    const [{ data: bindings, error: bindingsError }, { data: gateways, error: gatewaysError }] = await Promise.all([
      supabase.from('funnel_gateway_bindings').select('id,funnel_id,gateway_id,role,priority,is_primary,status,created_at,updated_at').eq('funnel_id', funnelId).order('priority', { ascending: true }),
      supabase.from('gateways').select('id,display_name,provider,environment,status,capabilities').eq('user_id', user.id).order('display_name', { ascending: true }),
    ])
    if (bindingsError) throw bindingsError
    if (gatewaysError) throw gatewaysError
    return json({ bindings: bindings ?? [], gateways: gateways ?? [] })
  } catch (cause) {
    console.error('[funnels/gateway:get]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}
