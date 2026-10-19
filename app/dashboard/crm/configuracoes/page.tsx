'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'

type Tag = { id: string; name: string; description: string | null; active: boolean }
type QuickReply = { id: string; title: string; body: string; channel: string; active: boolean }
type ChannelAccount = { id: string; channel: string; provider: string; display_name: string | null; external_account_id: string | null; status: 'active' | 'inactive' | 'error'; credentials_ref: string | null; updated_at: string }
type Tab = 'tags' | 'replies' | 'whatsapp' | 'channels'
type Editor =
  | { kind: 'tag'; id: string | null; name: string; description: string; active: boolean }
  | { kind: 'reply'; id: string | null; title: string; body: string; channel: string; active: boolean }
  | { kind: 'channel'; id: string; displayName: string; status: 'active' | 'inactive'; label: string }

const CHANNELS: Record<string, string> = { all: 'Todos os canais', funnel_chat: 'Chat do funil', whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', email: 'E-mail', sms: 'SMS' }
const STATUS: Record<ChannelAccount['status'], [string, string]> = { active: ['Ativa', 'text-emerald-400'], inactive: ['Pausada', 'text-slate-500'], error: ['Com erro', 'text-red-400'] }
const ERRORS: Record<string, string> = { INFOBIP_BASE_URL_INVALID: 'Use a URL base da sua conta Infobip (ex.: xxxxx.api.infobip.com).', WHATSAPP_NUMBER_INVALID: 'Informe o número do WhatsApp com DDD.', INFOBIP_API_KEY_REQUIRED: 'Informe a API key da Infobip.', FORBIDDEN: 'Seu acesso não permite alterar esta configuração.', NAME_TAKEN: 'Já existe um item com esse nome.', TAG_NAME_INVALID: 'Informe um nome de até 60 caracteres.', QUICK_REPLY_TITLE_INVALID: 'Informe um título de até 80 caracteres.', QUICK_REPLY_BODY_INVALID: 'Informe o texto da resposta (até 4000 caracteres).' }
const messageOf = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível salvar.' }
const input = 'h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40'
const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500'

type WhatsappState = { status: 'connected' | 'connecting' | 'waiting_scan' | 'disconnected'; qr: string | null; code?: string | null; phone: string | null }

// Pairs the organization's WhatsApp (Baileys bridge) like WhatsApp Web: QR code, or a pairing code sent to the phone number.
function WhatsappConnect({ onConnected }: { onConnected: () => void }) {
  const [state, setState] = useState<WhatsappState | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [phone, setPhone] = useState('')
  const call = useCallback(async (method: 'GET' | 'POST' | 'DELETE', payload?: { phone: string }) => {
    const res = await fetch('/api/crm/whatsapp', { method, cache: 'no-store', ...(method === 'POST' && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {}) }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setFailure(data.error === 'WHATSAPP_BRIDGE_NOT_CONFIGURED' ? 'Servidor do WhatsApp não configurado.' : data.error === 'INVALID_PHONE' ? 'Número inválido. Use DDD + número, ex. 11999999999.' : 'Servidor do WhatsApp indisponível.'); return }
    setFailure(''); setState(data as WhatsappState)
    if (method === 'POST') onConnected()
  }, [onConnected])
  useEffect(() => { void call('GET') }, [call])
  const pairing = state?.status === 'connecting' || state?.status === 'waiting_scan'
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => void call('GET'), 3000)
    return () => clearInterval(timer)
  }, [pairing, call])
  const act = async (method: 'POST' | 'DELETE', payload?: { phone: string }) => { setBusy(true); await call(method, payload); setBusy(false) }

  return <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center">
    <div className="min-w-0 flex-1">
      <b className="text-sm">Baileys · QR Code ou código</b>
      <span className={`ml-2 text-[11px] ${state?.status === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`}>{state?.status === 'connected' ? `Conectado${state.phone ? ` · +${state.phone}` : ''}` : pairing ? (state.code || phone ? 'Aguardando o código no celular' : 'Aguardando leitura do QR') : 'Desconectado'}</span>
      <p className="text-xs text-slate-500">Conecta um número comum de WhatsApp, como no WhatsApp Web.</p>
      {failure && <p role="alert" className="mt-1 text-xs text-red-400">{failure}</p>}
      {state?.status === 'waiting_scan' && <p className="mt-1 text-xs text-slate-400">No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho{state.code ? ' › Conectar com número de telefone, e digite o código.' : '.'}</p>}
      {!pairing && state?.status !== 'connected' && <div className="mt-3 flex max-w-sm gap-2"><input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="Número com DDD, ex. 11999999999" aria-label="Número do WhatsApp para conectar com código" className={input} /><button type="button" disabled={busy || !phone.replace(/\D/g, '')} onClick={() => void act('POST', { phone })} className="h-10 shrink-0 rounded-xl border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/[.06] disabled:opacity-50">Conectar com código</button></div>}
    </div>
    {state?.status === 'waiting_scan' && state.code && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-center"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Código</div><b className="font-mono text-2xl tracking-[.2em] text-emerald-300">{state.code.slice(0, 4)}-{state.code.slice(4)}</b></div>}
    {state?.status === 'waiting_scan' && state.qr && <img src={state.qr} alt="QR Code para conectar o WhatsApp" className="h-44 w-44 rounded-xl bg-white p-2" />}
    {state?.status === 'connecting' && <Loader2 size={18} className="animate-spin text-emerald-400" />}
    {state?.status === 'connected'
      ? <button type="button" disabled={busy} onClick={() => void act('DELETE')} className="h-9 rounded-xl border border-white/10 px-3 text-sm text-slate-300 hover:bg-white/[.06] disabled:opacity-50">Desconectar</button>
      : !pairing && <button type="button" disabled={busy || !state && !failure} onClick={() => void act('POST')} className="h-9 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-50">Conectar WhatsApp</button>}
  </div>
}

type WhatsappSettings = { id: string; provider: string; status: string; base_url: string | null; from_number: string | null; has_api_key: boolean; webhook_token: string | null }
type Db = ReturnType<typeof createSupabaseBrowserClient>

// The organization has one WhatsApp number, used by support (CRM chat) and by the automatic
// pending-payment message. Here the admin picks which provider sends through it.
function WhatsappPanel({ db }: { db: Db }) {
  const [settings, setSettings] = useState<WhatsappSettings | null>(null)
  const [provider, setProvider] = useState<'baileys' | 'infobip'>('baileys')
  const [form, setForm] = useState({ baseUrl: '', from: '', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const apply = useCallback((data: WhatsappSettings | null) => {
    setSettings(data)
    if (data) { setProvider(data.provider === 'infobip' ? 'infobip' : 'baileys'); setForm({ baseUrl: data.base_url ?? '', from: data.from_number ?? '', apiKey: '' }) }
  }, [])
  const reload = useCallback(() => { void db.rpc('crm_whatsapp_settings').then(({ data }: { data: WhatsappSettings | null }) => apply(data)) }, [db, apply])
  useEffect(reload, [reload])

  async function saveInfobip() {
    setSaving(true); setNotice('')
    const { data, error } = await db.rpc('crm_whatsapp_configure', { p_provider: 'infobip', p_base_url: form.baseUrl, p_from_number: form.from, p_api_key: form.apiKey || null })
    setSaving(false)
    if (error) { setNotice(messageOf(error)); return }
    apply(data as WhatsappSettings); setNotice('Infobip salva e em uso.')
  }

  const inUse = settings?.provider === 'infobip' ? 'Infobip' : settings?.provider === 'baileys' ? 'Baileys' : null
  const webhook = settings?.provider === 'infobip' && settings.webhook_token
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')}/functions/v1/crm-channel-infobip-webhook?account=${settings.id}&token=${settings.webhook_token}` : ''

  return <div>
    <div className="border-b border-white/[.06] px-4 py-4">
      <p className="text-sm">Este número atende o <b>suporte</b> (chat do CRM) e envia a mensagem automática quando um <b>pagamento fica pendente por mais de 5 minutos</b>.</p>
      <p className="mt-1 text-xs text-slate-500">Em uso: <span className={inUse ? 'text-emerald-400' : ''}>{inUse ?? 'nenhum provedor'}</span>. Trocar o provedor mantém as conversas do suporte.</p>
      <div role="radiogroup" aria-label="Provedor do WhatsApp" className="mt-3 grid gap-2 sm:grid-cols-2">
        {([['baileys', 'Baileys', 'Número comum, conectado por QR Code.'], ['infobip', 'Infobip', 'API oficial do WhatsApp Business.']] as const).map(([id, name, hint]) =>
          <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${provider === id ? 'border-emerald-500/40 bg-emerald-500/[.05]' : 'border-white/10'}`}>
            <input type="radio" name="whatsapp-provider" checked={provider === id} onChange={() => { setProvider(id); setNotice('') }} className="mt-1 accent-emerald-500" />
            <span className="text-sm">{name}{settings?.provider === id && <span className="ml-2 text-[10px] text-emerald-400">em uso</span>}<span className="block text-xs text-slate-500">{hint}</span></span>
          </label>)}
      </div>
    </div>
    {provider === 'baileys'
      ? <>{settings?.provider === 'infobip' && <p className="px-4 pt-3 text-xs text-amber-300">Ao conectar pelo QR Code, o WhatsApp deixa de usar a Infobip e passa a usar o Baileys.</p>}<WhatsappConnect key={settings?.provider} onConnected={reload} /></>
      : <div className="space-y-3 px-4 py-4">
        <label className="block space-y-1"><span className={label}>URL base da Infobip</span><input value={form.baseUrl} placeholder="xxxxx.api.infobip.com" onChange={event => setForm({ ...form, baseUrl: event.target.value })} className={input} /></label>
        <label className="block space-y-1"><span className={label}>Número do WhatsApp (remetente)</span><input value={form.from} inputMode="tel" placeholder="55 11 99999-0000" onChange={event => setForm({ ...form, from: event.target.value })} className={input} /></label>
        <label className="block space-y-1"><span className={label}>API key</span><input type="password" autoComplete="off" value={form.apiKey} placeholder={settings?.has_api_key ? '•••••••• (mantida; preencha para trocar)' : ''} onChange={event => setForm({ ...form, apiKey: event.target.value })} className={input} /></label>
        {webhook && <label className="block space-y-1"><span className={label}>Webhook (cole na Infobip: mensagens recebidas e relatórios de entrega)</span><input readOnly value={webhook} onFocus={event => event.currentTarget.select()} className={`${input} text-xs text-slate-400`} /></label>}
        <button type="button" disabled={saving || !form.baseUrl.trim() || !form.from.trim() || (!form.apiKey.trim() && !settings?.has_api_key)} onClick={() => void saveInfobip()} className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} {settings?.provider === 'infobip' ? 'Salvar' : 'Salvar e usar Infobip'}</button>
      </div>}
    {notice && <p role="status" className="px-4 pb-4 text-xs text-slate-400">{notice}</p>}
  </div>
}

export default function CrmConfiguracoesPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [tab, setTab] = useState<Tab>('tags')
  const [tags, setTags] = useState<Tag[]>([])
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [channels, setChannels] = useState<ChannelAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const canConfigure = hasOrganizationCapability(access, 'can_manage_automations')
  const canIntegrations = hasOrganizationCapability(access, 'can_manage_integrations')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const current = parseOrganizationAccess(accessResult.data)
      setAccess(current)
      if (!current) return
      const org = current.organization_id
      const [tagResult, replyResult, channelResult] = await Promise.all([
        db.from('crm_tags').select('id,name,description,active').eq('organization_id', org).order('name'),
        db.from('crm_quick_replies').select('id,title,body,channel,active').eq('organization_id', org).order('title'),
        hasOrganizationCapability(current, 'can_manage_integrations')
          ? db.from('crm_channel_accounts').select('id,channel,provider,display_name,external_account_id,status,credentials_ref,updated_at').eq('organization_id', org).order('channel')
          : Promise.resolve({ data: [], error: null }),
      ])
      for (const result of [tagResult, replyResult, channelResult]) if (result.error) throw result.error
      setTags((tagResult.data ?? []) as Tag[])
      setReplies((replyResult.data ?? []) as QuickReply[])
      setChannels((channelResult.data ?? []) as ChannelAccount[])
    } catch (cause) {
      console.error('[ALTHEA-CRM-CONFIG]', cause)
      setError('Não foi possível carregar as configurações do CRM.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    const result = editor.kind === 'tag'
      ? await db.rpc('crm_tag_save', { p_id: editor.id, p_name: editor.name, p_description: editor.description, p_active: editor.active })
      : editor.kind === 'reply'
        ? await db.rpc('crm_quick_reply_save', { p_id: editor.id, p_title: editor.title, p_body: editor.body, p_channel: editor.channel, p_active: editor.active })
        : await db.rpc('crm_channel_account_update', { p_id: editor.id, p_display_name: editor.displayName, p_status: editor.status })
    setSaving(false)
    if (result.error) { setError(messageOf(result.error)); return }
    setEditor(null)
    await load()
  }

  const tabs: [Tab, string, number][] = [['tags', 'Etiquetas', tags.length], ['replies', 'Respostas rápidas', replies.length], ...(canIntegrations ? [['whatsapp', 'WhatsApp', channels.filter(account => account.channel === 'whatsapp').length], ['channels', 'Outros canais', channels.filter(account => account.channel !== 'whatsapp').length]] as [Tab, string, number][] : [])]
  const empty = (text: string) => <div className="p-10 text-center text-sm text-slate-600">{text}</div>
  const editButton = (name: string, onClick: () => void) => <button type="button" aria-label={`Editar ${name}`} onClick={onClick} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"><Pencil size={14} /></button>
  const inactive = (active: boolean) => !active && <span className="ml-2 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] text-slate-500">inativa</span>
  const canAdd = tab === 'tags' || tab === 'replies' ? canConfigure : false

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // CRM</div><h1 className="text-3xl font-black tracking-tight">Configurações do CRM</h1><p className="mt-1 text-sm text-slate-500">Etiquetas, respostas rápidas e canais conectados da organização.</p></div>
        <div className="flex gap-2">
          {canAdd && <button type="button" onClick={() => setEditor(tab === 'tags' ? { kind: 'tag', id: null, name: '', description: '', active: true } : { kind: 'reply', id: null, title: '', body: '', channel: 'all', active: true })} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400"><Plus size={15} /> {tab === 'tags' ? 'Nova etiqueta' : 'Nova resposta'}</button>}
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[.03] px-3 hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <div role="tablist" aria-label="Seção" className="mb-4 flex flex-wrap gap-1">{tabs.map(([id, name, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === id ? 'bg-white/[.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}>{name} <span className="text-slate-600">{count}</span></button>)}</div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error}</div>}
      {!canConfigure && (tab === 'tags' || tab === 'replies') && !loading && <p className="mb-4 text-xs text-slate-500">Somente leitura: alterar etiquetas e respostas exige a permissão de gerenciar automações.</p>}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
        {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-slate-500"><Loader2 size={18} className="animate-spin text-emerald-400" /> Carregando</div>
          : tab === 'tags' ? (tags.length ? tags.map(tag => <div key={tag.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{tag.name}</b>{inactive(tag.active)}{tag.description && <p className="truncate text-xs text-slate-500">{tag.description}</p>}</div>{canConfigure && editButton(tag.name, () => setEditor({ kind: 'tag', id: tag.id, name: tag.name, description: tag.description ?? '', active: tag.active }))}</div>) : empty('Nenhuma etiqueta. Etiquetas organizam conversas por assunto ou perfil.'))
          : tab === 'replies' ? (replies.length ? replies.map(reply => <div key={reply.id} className="flex items-start gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{reply.title}</b>{inactive(reply.active)}<span className="ml-2 text-[11px] text-slate-500">{CHANNELS[reply.channel] ?? reply.channel}</span><p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{reply.body}</p></div>{canConfigure && editButton(reply.title, () => setEditor({ kind: 'reply', id: reply.id, title: reply.title, body: reply.body, channel: reply.channel, active: reply.active }))}</div>) : empty('Nenhuma resposta rápida. Cadastre textos que a equipe envia com frequência.'))
          : tab === 'whatsapp' ? <WhatsappPanel db={db} />
          : channels.filter(account => account.channel !== 'whatsapp').length ? channels.filter(account => account.channel !== 'whatsapp').map(account => { const [statusLabel, tone] = STATUS[account.status]; const name = account.display_name || `${CHANNELS[account.channel] ?? account.channel} · ${account.provider}`; return <div key={account.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{name}</b><span className={`ml-2 text-[11px] ${tone}`}>{statusLabel}</span><p className="truncate text-xs text-slate-500">{CHANNELS[account.channel] ?? account.channel} · {account.provider}{account.external_account_id ? ` · ${account.external_account_id}` : ''} · {account.credentials_ref ? 'credencial configurada' : 'sem credencial'}</p></div>{editButton(name, () => setEditor({ kind: 'channel', id: account.id, displayName: account.display_name ?? '', status: account.status === 'active' ? 'active' : 'inactive', label: name }))}</div> }) : empty('Nenhum outro canal conectado. A conexão de e-mail e SMS é feita pela equipe Althea.')}
      </section>
    </div>

    {editor && <div role="dialog" aria-modal="true" aria-label="Editar" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setEditor(null) }}>
      <div className="w-full max-w-lg rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-black">{editor.kind === 'tag' ? (editor.id ? 'Editar etiqueta' : 'Nova etiqueta') : editor.kind === 'reply' ? (editor.id ? 'Editar resposta' : 'Nova resposta') : editor.label}</h2><button type="button" onClick={() => setEditor(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
        <div className="space-y-3">
          {editor.kind === 'tag' && <>
            <label className="block space-y-1"><span className={label}>Nome</span><input value={editor.name} maxLength={60} onChange={event => setEditor({ ...editor, name: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Descrição</span><input value={editor.description} maxLength={500} onChange={event => setEditor({ ...editor, description: event.target.value })} className={input} /></label>
          </>}
          {editor.kind === 'reply' && <>
            <label className="block space-y-1"><span className={label}>Título</span><input value={editor.title} maxLength={80} onChange={event => setEditor({ ...editor, title: event.target.value })} className={input} /></label>
            <label className="block space-y-1"><span className={label}>Texto</span><textarea value={editor.body} maxLength={4000} rows={5} onChange={event => setEditor({ ...editor, body: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40" /></label>
            <label className="block space-y-1"><span className={label}>Canal</span><select value={editor.channel} onChange={event => setEditor({ ...editor, channel: event.target.value })} className={`${input} bg-[#0b100e]`}>{Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          </>}
          {editor.kind === 'channel' && <>
            <label className="block space-y-1"><span className={label}>Nome de exibição</span><input value={editor.displayName} maxLength={120} onChange={event => setEditor({ ...editor, displayName: event.target.value })} className={input} /></label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={editor.status === 'active'} onChange={event => setEditor({ ...editor, status: event.target.checked ? 'active' : 'inactive' })} className="accent-emerald-500" /><span className="text-sm">Conta ativa <span className="block text-xs text-slate-500">Pausada, a conta não envia mensagens: automações, recuperação de checkout e envios do CRM param.</span></span></label>
          </>}
          {editor.kind !== 'channel' && <label className="flex items-center gap-3"><input type="checkbox" checked={editor.active} onChange={event => setEditor({ ...editor, active: event.target.checked })} className="accent-emerald-500" /><span className="text-sm">Ativa</span></label>}
        </div>
        <button type="button" onClick={() => void save()} disabled={saving || (editor.kind === 'tag' && !editor.name.trim()) || (editor.kind === 'reply' && (!editor.title.trim() || !editor.body.trim()))} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button>
      </div>
    </div>}
  </main>
}
