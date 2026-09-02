import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type Rule = { id: string; name: string; enabled: boolean; event_type: string; conditions: Record<string, unknown>; action_type: string; action_config: Record<string, unknown> }
type EventRow = { id: string; transaction_id: string | null; status: string; error_reason: string | null; buyer_email: string | null; buyer_name: string | null; payload: Record<string, unknown> }

function matches(rule: Rule, event: EventRow): boolean {
  if (!rule.enabled || (rule.event_type !== `transaction.${event.status}` && !(rule.event_type === 'transaction.failed' && event.status === 'failed'))) return false
  for (const [key, expected] of Object.entries(rule.conditions)) {
    const actual = key === 'transaction_status' ? event.status : key === 'error_reason' ? event.error_reason : event.payload[key]
    if (String(actual ?? '').toLowerCase() !== String(expected ?? '').toLowerCase()) return false
  }
  return true
}

function getAllowedWebhookOrigins(): Set<string> {
  return new Set((process.env.ALTHEA_WEBHOOK_ALLOWLIST ?? '').split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
    try { return new URL(value).origin } catch { return '' }
  }).filter(Boolean))
}

function isAllowedWebhookUrl(rawUrl: string, allowlist: Set<string>): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && allowlist.has(url.origin)
  } catch { return false }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (typeof body !== 'object' || body === null || !('event_id' in body)) return NextResponse.json({ error: 'event_id_required' }, { status: 400 })

  const eventId = String((body as { event_id: unknown }).event_id)
  const eventResult = await supabase.from('crm_webhook_events').select('id,transaction_id,status,error_reason,buyer_email,buyer_name,payload').eq('id', eventId).eq('user_id', auth.user.id).maybeSingle()
  if (eventResult.error || !eventResult.data) return NextResponse.json({ error: 'event_not_found' }, { status: 404 })
  const event = eventResult.data as EventRow

  const rulesResult = await supabase.from('crm_trigger_rules').select('id,name,enabled,event_type,conditions,action_type,action_config').eq('user_id', auth.user.id).eq('enabled', true)
  if (rulesResult.error) return NextResponse.json({ error: 'rule_lookup_failed', detail: rulesResult.error.message }, { status: 500 })
  const rules = (rulesResult.data ?? []) as Rule[]
  const matched = rules.filter((rule) => matches(rule, event))
  if (!matched.length) return NextResponse.json({ matched: 0, dispatched: 0 })

  const allowlist = getAllowedWebhookOrigins()
  const results: Array<{ rule_id: string; action: string; dispatched: boolean; detail?: string }> = []

  for (const rule of matched) {
    if (rule.action_type === 'automated_whatsapp_dispatch') {
      const webhookUrl = process.env.WHATSAPP_DISPATCH_URL
      if (!webhookUrl) {
        results.push({ rule_id: rule.id, action: rule.action_type, dispatched: false, detail: 'WHATSAPP_DISPATCH_URL_NOT_CONFIGURED' })
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3500)
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Althea-Event': event.id, 'Idempotency-Key': `crm:${event.id}:${rule.id}` },
          body: JSON.stringify({ to: event.payload.phone ?? event.payload.buyer_phone ?? null, buyer_name: event.buyer_name, transaction_id: event.transaction_id, dynamic_discount_link: rule.action_config.dynamic_discount_link ?? null, trigger_rule_id: rule.id })
        })
        results.push({ rule_id: rule.id, action: rule.action_type, dispatched: response.ok, detail: response.ok ? 'accepted' : `provider_http_${response.status}` })
      } catch (cause) {
        results.push({ rule_id: rule.id, action: rule.action_type, dispatched: false, detail: cause instanceof Error ? cause.message : 'dispatch_failed' })
      } finally { clearTimeout(timer) }
    } else if (rule.action_type === 'create_support_task') {
      results.push({ rule_id: rule.id, action: rule.action_type, dispatched: true, detail: 'support_task_accepted' })
    } else if (rule.action_type === 'emit_reverse_webhook') {
      const reverseUrl = typeof rule.action_config.url === 'string' ? rule.action_config.url : null
      if (!reverseUrl || !isAllowedWebhookUrl(reverseUrl, allowlist)) {
        results.push({ rule_id: rule.id, action: rule.action_type, dispatched: false, detail: 'reverse_webhook_url_not_allowlisted' })
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3500)
      try {
        const response = await fetch(reverseUrl, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Althea-Event': event.id, 'Idempotency-Key': `crm:${event.id}:${rule.id}` },
          body: JSON.stringify({ event_id: event.id, transaction_id: event.transaction_id, status: event.status, rule_id: rule.id })
        })
        results.push({ rule_id: rule.id, action: rule.action_type, dispatched: response.ok, detail: `provider_http_${response.status}` })
      } catch (cause) {
        results.push({ rule_id: rule.id, action: rule.action_type, dispatched: false, detail: cause instanceof Error ? cause.message : 'dispatch_failed' })
      } finally { clearTimeout(timer) }
    }
  }

  await supabase.from('crm_webhook_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id).eq('user_id', auth.user.id)
  return NextResponse.json({ matched: matched.length, dispatched: results.filter((result) => result.dispatched).length, results })
}
