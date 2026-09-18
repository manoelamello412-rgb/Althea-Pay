import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('funnel operational mirror', () => {
  test('uses a security-invoker unified read model instead of copying operational data', () => {
    const migration = source('supabase/migrations/20260918151516_funnel_operational_timeline_v11.sql')
    expect(migration).toContain('v_funnel_operational_timeline')
    expect(migration).toContain('security_invoker=true')
    expect(migration).toContain('from public.integration_events')
    expect(migration).toContain('from public.checkout_events')
    expect(migration).toContain('from public.gateway_transactions')
    expect(migration).toContain('from public.gateway_payment_attempts')
    expect(migration).toContain('from public.sales')
    expect(migration).toContain('from public.transaction_audit_events')
    expect(migration).toContain('from public.funnel_control_drift_events')
    expect(migration).toContain('from public.funnel_command_targets')
    expect(migration).toContain('from public.funnel_connections')
    expect(migration).not.toContain('create table public.v_funnel_operational_timeline')
  })

  test('keeps the timeline unavailable to anon while authenticated access inherits source RLS', () => {
    const migration = source('supabase/migrations/20260918151516_funnel_operational_timeline_v11.sql')
    expect(migration).toContain('revoke all on public.v_funnel_operational_timeline from anon')
    expect(migration).toContain('grant select on public.v_funnel_operational_timeline to authenticated')
  })

  test('canonical funnel page embeds the operational mirror and does not render the legacy event list', () => {
    const page = source('app/dashboard/funil/page.tsx')
    expect(page).toContain('FunnelOperationalMirror')
    expect(page).toContain('<FunnelOperationalMirror funnelId={funnel.id} />')
    expect(page).not.toContain('Eventos recentes</h2>')
  })

  test('includes chat delivery state without exposing the internal outbox table', () => {
    const migration = source('supabase/migrations/20260918153239_funnel_operational_chat_delivery_v13.sql')
    const dispatcher = source('supabase/functions/crm-channel-outbox-dispatcher/index.ts')
    expect(migration).toContain("from public.crm_messages m")
    expect(migration).toContain("m.channel='funnel_chat'")
    expect(migration).toContain("delivery_status")
    expect(migration).toContain("dead_letter")
    expect(migration).toContain("security_invoker=true")
    expect(migration).not.toContain("grant select on public.crm_channel_message_outbox to authenticated")
    expect(dispatcher).toContain("markLocalMessageFailure")
    expect(dispatcher).toContain("delivery_error")
  })

  test('deduplicates operational incident counters by transaction or checkout identity', () => {
    const component = source('components/funnel-operational-mirror.tsx')
    expect(component).toContain("const incidentKey")
    expect(component).toContain("transaction:")
    expect(component).toContain("checkout:")
    expect(component).toContain("new Set(")
  })

  test('includes webhook health with signature and response failures', () => {
    const migration = source('supabase/migrations/20260918153559_funnel_operational_webhook_health_v14.sql')
    expect(migration).toContain('from public.webhook_deliveries d')
    expect(migration).toContain('join public.webhook_integrations wi')
    expect(migration).toContain("signature_valid=false")
    expect(migration).toContain("Assinatura do webhook inválida.")
    expect(migration).toContain('grant select on public.webhook_deliveries to authenticated')
    expect(migration).toContain('revoke all on public.v_funnel_operational_timeline from anon')
  })

  test('mirror exposes payment, checkout, chat, health and control filters', () => {
    const component = source('components/funnel-operational-mirror.tsx')
    expect(component).toContain("v_funnel_operational_timeline")
    expect(component).toContain("Pagamentos")
    expect(component).toContain("Checkout")
    expect(component).toContain("Chat")
    expect(component).toContain("Saúde & controle")
    expect(component).toContain("atualização 15s")
  })
})
