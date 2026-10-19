import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// "Enviar agora": schedules the draft for now as the user (crm_campaign_set_status checks can_manage_automations),
// then enqueues and kicks the dispatcher right away instead of waiting for the minute crons.
// Staggered WhatsApp sends (20-60 s apart) still go out through the althea-crm-outbox-dispatcher cron.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { id } = await request.json().catch(() => ({})) as { id?: unknown }
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'INVALID_CAMPAIGN' }, { status: 400 })

  const scheduled = await supabase.rpc('crm_campaign_set_status', { p_id: id, p_status: 'scheduled', p_scheduled_at: new Date().toISOString() })
  if (scheduled.error) return NextResponse.json({ error: scheduled.error.message }, { status: 409 })

  const enqueued = await createSupabaseAdminClient().rpc('crm_campaign_enqueue_due', { p_limit: 5 })
  if (enqueued.error) return NextResponse.json({ error: 'CAMPAIGN_ENQUEUE_FAILED' }, { status: 500 })

  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const secret = process.env.ALTHEA_INTERNAL_SECRET
  if (base && secret) {
    // Best effort: if this fails the cron delivers on the next minute.
    await fetch(`${base}/functions/v1/crm-channel-outbox-dispatcher`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ limit: 50 }), cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => null)
  }
  return NextResponse.json({ ok: true })
}
