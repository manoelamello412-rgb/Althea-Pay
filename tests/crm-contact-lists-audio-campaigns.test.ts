import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { audioMimetype, bridgeSendRequest } from '../supabase/functions/_shared/whatsapp'

const migration = readFileSync('supabase/migrations/20261014180000_crm_contact_lists_audio_campaigns_v1.sql', 'utf8')
const dispatcher = readFileSync('supabase/functions/crm-channel-outbox-dispatcher/index.ts', 'utf8')
const bridge = readFileSync('whatsapp-bridge/server.mjs', 'utf8')
const clients = readFileSync('app/dashboard/clientes/page.tsx', 'utf8')
const campaigns = readFileSync('app/dashboard/crm/campanhas/page.tsx', 'utf8')

describe('contact lists', () => {
  it('are written only through org-checked RPCs and read under RLS', () => {
    expect(migration).toContain('revoke all on public.crm_contact_lists, public.crm_contact_list_members from anon, authenticated;')
    expect(migration).toContain("private.crm_config_context('can_manage_automations')")
    expect(migration).toContain('where cl.organization_id = c.organization_id and cl.id = any(p_client_ids)')
    expect(clients).toContain("rpc('crm_contact_list_add'")
    expect(clients).not.toMatch(/from\('crm_contact_list[^']*'\)\.(insert|update|upsert|delete)/)
  })

  it('normalizes bare Brazilian phones and skips opt-outs', () => {
    expect(migration).toContain("when length(d.digits) in (10, 11) then '55' || d.digits")
    expect(migration).toContain("k.status = 'opted_out'")
  })

  it('gives never-contacted list members a WhatsApp conversation and identity for the dispatcher', () => {
    expect(migration).toContain("insert into public.crm_conversations (user_id, organization_id, status, primary_channel")
    expect(migration).toContain('on conflict (user_id, channel, external_user_id) do update')
  })
})

describe('campaign with list and audio', () => {
  it('targets exactly one of segment or list and keeps audio inside the org folder', () => {
    expect(migration).toContain('check (num_nonnulls(segment_id, list_id) = 1)')
    expect(migration).toContain("split_part(v_audio, '/', 1) <> c.organization_id::text")
    expect(campaigns).toContain('`${access.organization_id}/${crypto.randomUUID()}.${ext}`')
  })

  it('spaces WhatsApp sends 20–60 s apart and only names a template when there is one', () => {
    expect(migration).toContain("if k.channel = 'whatsapp' then v_offset := v_offset + 20 + floor(random() * 41)::integer; end if;")
    expect(migration).toContain("now() + make_interval(secs => v_offset)")
    expect(migration).toContain("k.channel = 'whatsapp' and k.whatsapp_template_name is not null")
  })

  it('sends audio before text through the bridge with a short-lived signed URL', () => {
    expect(dispatcher).toContain('createSignedUrl(audioPath, 900)')
    expect(dispatcher.indexOf('if (text(row.metadata?.audio_path)) throw new Error("whatsapp_audio_unsupported")')).toBeLessThan(dispatcher.indexOf('async function sendMeta('))
    expect(bridge.indexOf("present(sock, found.jid, 'recording')")).toBeLessThan(bridge.indexOf("present(sock, found.jid, 'composing')"))
    const { init } = bridgeSendRequest({ baseUrl: 'https://wa.example.com', token: 't', accountId: '5a5fee1a-aaba-4228-b2cb-b5d0229e649b', to: '11987654567', body: 'Oi', audio: { url: 'https://s/a.ogg', mimetype: audioMimetype('org/a.ogg') } })
    expect(JSON.parse(String(init.body))).toEqual({ to: '5511987654567', text: 'Oi', audio_url: 'https://s/a.ogg', audio_mimetype: 'audio/ogg; codecs=opus' })
    expect(audioMimetype('x.MP3')).toBe('audio/mpeg')
  })
})
