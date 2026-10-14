import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderTemplate, signUnsubscribe, templateMessage, verifyUnsubscribe } from '../supabase/functions/_shared/remarketing'

const migration = readFileSync('supabase/migrations/20261013200000_crm_remarketing_campaigns_v1.sql', 'utf8')
const dispatcher = readFileSync('supabase/functions/crm-channel-outbox-dispatcher/index.ts', 'utf8')
const unsubscribe = readFileSync('supabase/functions/crm-channel-unsubscribe/index.ts', 'utf8')
const recovery = readFileSync('supabase/functions/checkout-recovery-worker/index.ts', 'utf8')
const automation = readFileSync('supabase/functions/automation-engine-v2/index.ts', 'utf8')
const page = readFileSync('app/dashboard/crm/campanhas/page.tsx', 'utf8')
const body = (fn: string) => migration.slice(migration.indexOf(`function public.${fn}(`), migration.indexOf('$function$;', migration.indexOf(`function public.${fn}(`)))

describe('templates', () => {
  it('renders WhatsApp-style positional placeholders like the SQL renderer', () => {
    expect(renderTemplate('Oi {{1}}, volte: {{2}} {{1}}', ['primeiro_nome', 'link'], { primeiro_nome: 'Ana', link: 'https://x' })).toBe('Oi Ana, volte: https://x Ana')
    expect(renderTemplate('Oi {{1}}', ['nome'], {})).toBe('Oi ')
  })

  it('builds dispatcher metadata for WhatsApp templates and e-mail subjects', () => {
    const wa = templateMessage({ body: 'Oi {{1}}', subject: null, variables: ['nome'], whatsapp_template_name: 'recupera', language: 'pt_BR' }, { nome: 'Ana' })
    expect(wa).toEqual({ body: 'Oi Ana', metadata: { whatsapp_template: { name: 'recupera', language: 'pt_BR', placeholders: ['Ana'] } } })
    const mail = templateMessage({ body: 'b', subject: '{{1}}, esqueceu algo?', variables: ['nome'], whatsapp_template_name: null, language: 'pt_BR' }, { nome: 'Ana' })
    expect(mail.metadata).toEqual({ email_subject: 'Ana, esqueceu algo?' })
  })
})

describe('unsubscribe tokens', () => {
  it('round-trips and rejects tampering or a wrong secret', async () => {
    const token = await signUnsubscribe('s3cret', { o: 'org-1', c: 'email', a: 'ana@x.com' })
    expect(await verifyUnsubscribe('s3cret', token)).toEqual({ o: 'org-1', c: 'email', a: 'ana@x.com' })
    expect(await verifyUnsubscribe('other', token)).toBeNull()
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ o: 'org-2', c: 'email', a: 'ana@x.com' })).toString('base64url')
    expect(await verifyUnsubscribe('s3cret', `${forged}.${signature}`)).toBeNull()
    expect(await verifyUnsubscribe('s3cret', payload)).toBeNull()
    await expect(signUnsubscribe('', { o: 'o', c: 'email', a: 'a' })).rejects.toThrow('unsubscribe_secret_missing')
  })

  it('only unsubscribes on POST and only through the service RPC', () => {
    expect(unsubscribe.indexOf('req.method === "GET"')).toBeLessThan(unsubscribe.indexOf('crm_channel_record_consent'))
    expect(migration).toContain('grant execute on function public.crm_channel_record_consent(uuid, text, text, text, text) to service_role;')
    expect(dispatcher).toContain('"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"')
    expect(dispatcher).toContain('row.metadata?.source !== "campaign"')
  })
})

describe('campaign migration', () => {
  it('scopes templates, segments and campaigns to the organization with RPC-only writes', () => {
    expect(migration).toContain('drop policy if exists crm_segments_owner on public.crm_segments;')
    for (const table of ['crm_message_templates', 'crm_campaigns', 'crm_segments']) expect(migration).toContain(`create policy ${table}_org_select on public.${table} for select to authenticated using (private.has_org_capability(organization_id, 'can_view_chats'));`)
    expect(migration).toContain('revoke all on public.crm_message_templates, public.crm_campaigns from anon, authenticated;')
    for (const fn of ['crm_template_save', 'crm_segment_save', 'crm_campaign_save', 'crm_campaign_set_status']) {
      expect(body(fn)).toContain("private.crm_config_context('can_manage_automations')")
      expect(body(fn)).toContain('insert into public.audit_logs')
    }
  })

  it('excludes opted-out contacts and enqueues idempotently per campaign + address', () => {
    expect(migration).toMatch(/not exists \(\s*select 1 from public\.crm_channel_consents k[\s\S]*k\.status = 'opted_out'\)/)
    const enqueue = body('crm_campaign_enqueue_due')
    expect(enqueue).toContain("'campaign:' || k.id || ':' || r.address")
    expect(enqueue).toContain('on conflict (user_id, idempotency_key) do nothing')
    expect(enqueue).toContain('for update of cp skip locked')
    expect(migration).toContain('grant execute on function public.crm_campaign_enqueue_due(integer) to service_role;')
    expect(migration).toContain("cron.schedule('althea-crm-campaign-enqueue'")
  })

  it('fills link, valor and produto from the latest checkout and keeps enqueue idempotent', () => {
    const v2 = readFileSync('supabase/migrations/20261014150000_crm_campaign_checkout_variables_v1.sql', 'utf8')
    expect(v2).toContain("if k.variables && array['link', 'valor', 'produto'] then")
    expect(v2).toMatch(/'link', coalesce\([\s\S]*recovery_url[\s\S]*f\.url/)
    expect(v2).toContain("on conflict (user_id, idempotency_key) do nothing")
    expect(v2).toContain('grant execute on function public.crm_campaign_enqueue_due(integer) to service_role;')
    expect(readFileSync('supabase/migrations/20261014140000_crm_outbox_dispatcher_cron_v1.sql', 'utf8')).toContain("cron.schedule(\n  'althea-crm-outbox-dispatcher'")
  })

  it('only lets drafts be edited and requires active account and template to schedule', () => {
    expect(body('crm_campaign_save')).toContain("status = 'draft'")
    expect(body('crm_campaign_set_status')).toMatch(/a\.status = 'active'[\s\S]*t\.active/)
  })
})

describe('triggers and screen', () => {
  it('uses the organization template for cart recovery and automation sends', () => {
    expect(recovery).toContain('.eq("trigger_event", "checkout_abandoned")')
    expect(recovery).toContain('...message.metadata,')
    expect(automation).toContain('.eq("organization_id",rule.organization_id)')
    expect(automation).toContain('metadata:{...templateMeta,automation_rule_id:rule.id,automated:true}')
  })

  it('writes only through the audited RPCs', () => {
    expect(page).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    for (const fn of ['crm_campaign_save', 'crm_template_save', 'crm_segment_save', 'crm_campaign_set_status', 'crm_campaign_metrics']) expect(page).toContain(`'${fn}'`)
  })
})
