import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

describe('checkout recovery runtime', () => {
  it('claims recovery work atomically and limits attempts', async () => {
    const source = await readFile('supabase/migrations/20260918174753_checkout_recovery_runtime_v28.sql', 'utf8')

    expect(source).toContain('claim_checkout_recovery_events_v1')
    expect(source).toContain('for update of r skip locked')
    expect(source).toContain("c.recovery_count<5")
    expect(source).toContain("status='processing'")
    expect(source).toContain('recovery_events_org_status_next_idx')
  })

  it('uses the existing CRM outbox as the delivery authority', async () => {
    const source = await readFile('supabase/migrations/20260918174753_checkout_recovery_runtime_v28.sql', 'utf8')

    expect(source).toContain('crm_outbox_checkout_recovery_sync_trg')
    expect(source).toContain("if new.status='sent'")
    expect(source).toContain("recovery_status='sent'")
    expect(source).toContain("new.recovery_status:='recovered'")
    expect(source).toContain("new.status='completed'")
  })

  it('schedules enqueue and worker execution with pg_cron instead of mutating cron.job directly', async () => {
    const source = await readFile('supabase/migrations/20260918175215_checkout_recovery_scheduler_v29.sql', 'utf8')

    expect(source).toContain("cron.schedule(")
    expect(source).toContain("'althea-checkout-recovery-enqueue'")
    expect(source).toContain("'althea-checkout-recovery-worker'")
    expect(source).toContain('checkout-recovery-worker')
    expect(source).not.toContain('insert into cron.job')
    expect(source).not.toContain('update cron.job')
  })

  it('keeps internal worker RPCs service-role only without deprecated auth.role checks', async () => {
    const source = await readFile('supabase/migrations/20260918175508_recovery_internal_role_hardening_v30.sql', 'utf8')

    expect(source).toContain('to service_role')
    expect(source).toContain('from public,anon,authenticated')
    expect(source).not.toContain('auth.role()')
  })

  it('bounds recovery operation lists before aggregation', async () => {
    const source = await readFile('supabase/migrations/20260918175635_recovery_operations_bounded_v31.sql', 'utf8')

    expect(source).toContain('limit 100')
    expect(source).toContain('limit 200')
    expect(source).toContain('select jsonb_agg(x.item order by x.sort_at desc)')
    expect(source).toContain('private.is_org_member(v_org)')
  })

  it('never dispatches checkout recovery without explicit consent, a live channel and a destination', async () => {
    const source = await readFile('supabase/functions/checkout-recovery-worker/index.ts', 'utf8')

    expect(source).toContain('channelConsent')
    expect(source).toContain('"blocked_consent"')
    expect(source).toContain('"blocked_no_channel"')
    expect(source).toContain('"blocked_no_destination"')
    expect(source).toContain('.eq("status", "active")')
    expect(source).toContain('crm_channel_message_outbox')
    expect(source).toContain('recovery_checkout_id')
    expect(source).toContain('verify_althea_internal_secret')
  })

  it('surfaces Recovery as one canonical top-level operations screen', async () => {
    const page = await readFile('app/dashboard/recovery/page.tsx', 'utf8')
    const navigation = await readFile('components/mobile-shell.tsx', 'utf8')
    const legacy = await readFile('app/dashboard/crm/recovery/page.tsx', 'utf8')

    expect(page).toContain("rpc('recovery_operations_v1'")
    expect(page).toContain("rpc('recovery_operator_requeue_checkout_v1'")
    expect(page).toContain('blocked_no_channel')
    expect(page).toContain('Receita recuperada')
    expect(navigation).toContain("href: '/dashboard/recovery'")
    expect(legacy).toContain("redirect('/dashboard/recovery')")
  })

  it('documents consent as explicit rather than inferred from contact data', async () => {
    const contract = await readFile('docs/ALTHEA_INTEGRATION_CONTRACT.md', 'utf8')
    const connector = await readFile('docs/ALTHEA_FUNNEL_CONNECTOR.md', 'utf8')

    expect(contract).toContain('Recovery contact consent')
    expect(contract).toContain('explicit contact consent')
    expect(contract).toContain('blocked_consent')
    expect(connector).toContain('Consent is not inferred')
    expect(connector).toContain('recovery_url')
  })
})
