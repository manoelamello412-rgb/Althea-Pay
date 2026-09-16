import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function mapError(message: string) {
  if (message === 'FUNNEL_NOT_FOUND' || message === 'STEP_NOT_FOUND') return [404, message.toLowerCase()] as const
  if (message === 'FORBIDDEN') return [403, 'forbidden'] as const
  if (message.includes('REQUIRED') || message.includes('INVALID')) return [400, message.toLowerCase()] as const
  return [500, 'journey_operation_failed'] as const
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)
    const funnelId = text(new URL(request.url).searchParams.get('funnel_id'))
    if (!funnelId) return json({ error: 'funnel_id is required' }, 400)

    const [{ data: funnel, error: funnelError }, { data: steps, error: stepsError }, { data: links, error: linksError }, { data: offers, error: offersError }, { data: bindings, error: bindingsError }] = await Promise.all([
      supabase.from('funnels').select('id,nome,url,status,funnel_type,organization_id').eq('id', funnelId).is('deleted_at', null).maybeSingle(),
      supabase.from('funnel_steps').select('id,funnel_id,step_key,step_type,name,position,status,config,created_at,updated_at').eq('funnel_id', funnelId).order('position', { ascending: true }),
      supabase.from('funnel_step_links').select('id,from_step_id,to_step_id,condition,priority').eq('funnel_id', funnelId).order('priority', { ascending: true }),
      supabase.from('funnel_offers').select('id,product_id,step_id,offer_type,name,price,currency,status,config').eq('funnel_id', funnelId).order('created_at', { ascending: true }),
      supabase.from('funnel_gateway_bindings').select('id,gateway_id,role,priority,is_primary,status').eq('funnel_id', funnelId).order('priority', { ascending: true }),
    ])
    if (funnelError) throw funnelError
    if (!funnel) return json({ error: 'funnel_not_found' }, 404)
    if (stepsError) throw stepsError
    if (linksError) throw linksError
    if (offersError) throw offersError
    if (bindingsError) throw bindingsError
    return json({ funnel, steps: steps ?? [], links: links ?? [], offers: offers ?? [], gateway_bindings: bindings ?? [] })
  } catch (cause) {
    console.error('[funnels/journey:get]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)
    const body = await request.json().catch(() => ({}))
    const funnelId = text(body?.funnel_id)
    const stepType = text(body?.step_type)
    const name = text(body?.name)
    if (!funnelId || !stepType || !name) return json({ error: 'funnel_id, step_type and name are required' }, 400)
    const { data, error } = await supabase.rpc('add_funnel_step', { p_funnel_id: funnelId as unknown as number, p_step_type: stepType, p_name: name, p_config: body?.config && typeof body.config === 'object' ? body.config : {} })
    if (error) { const [status, code] = mapError(error.message); return json({ error: code }, status) }
    return json({ step: data })
  } catch (cause) {
    console.error('[funnels/journey:post]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'unauthorized' }, 401)
    const body = await request.json().catch(() => ({}))
    const stepId = text(body?.step_id)
    if (!stepId) return json({ error: 'step_id is required' }, 400)
    const config = body?.config === null || (body?.config && typeof body.config === 'object' && !Array.isArray(body.config)) ? body.config : null
    const { data, error } = await supabase.rpc('update_funnel_step', { p_step_id: stepId as unknown as number, p_name: body?.name == null ? null : text(body.name), p_status: body?.status == null ? null : text(body.status), p_config: config })
    if (error) { const [status, code] = mapError(error.message); return json({ error: code }, status) }
    return json({ step: data })
  } catch (cause) {
    console.error('[funnels/journey:patch]', cause)
    return json({ error: 'internal_error' }, 500)
  }
}
