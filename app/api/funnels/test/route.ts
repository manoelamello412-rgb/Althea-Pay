import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// "Testar conexão": sends a custom.connection_test event through funnel-events (internal auth) and reports
// whether it landed in integration_events. Proves the backend pipeline for this funnel end to end.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { funnel_id?: unknown }
  const funnelId = typeof body.funnel_id === 'string' ? body.funnel_id.trim() : ''
  if (!funnelId) return NextResponse.json({ error: 'funnel_id_required' }, { status: 400 })
  // RLS: only funnels of the caller's organization come back.
  const { data: funnel } = await supabase.from('funnels').select('id,user_id').eq('id', funnelId).is('deleted_at', null).maybeSingle()
  if (!funnel) return NextResponse.json({ error: 'funnel_not_found' }, { status: 404 })

  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const secret = process.env.ALTHEA_INTERNAL_SECRET
  if (!base || !secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })

  const response = await fetch(`${base}/functions/v1/funnel-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ user_id: funnel.user_id, funnel_id: funnel.id, event_type: 'custom.connection_test', event_id: `connection-test:${crypto.randomUUID()}`, source: 'painel' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  const result = response ? await response.json().catch(() => ({})) as { event_id?: string; error?: string } : {}
  if (!response?.ok || !result.event_id) return NextResponse.json({ ok: false, error: result.error ?? 'pipeline_unreachable' }, { status: 502 })
  return NextResponse.json({ ok: true, event_id: result.event_id })
}
