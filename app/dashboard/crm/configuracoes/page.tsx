'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'

type Tag = { id: string; name: string; description: string | null; active: boolean }
type QuickReply = { id: string; title: string; body: string; channel: string; active: boolean }
type ChannelAccount = { id: string; channel: string; provider: string; display_name: string | null; external_account_id: string | null; status: 'active' | 'inactive' | 'error'; credentials_ref: string | null; updated_at: string }
type Tab = 'tags' | 'replies' | 'channels'
type Editor =
  | { kind: 'tag'; id: string | null; name: string; description: string; active: boolean }
  | { kind: 'reply'; id: string | null; title: string; body: string; channel: string; active: boolean }
  | { kind: 'channel'; id: string; displayName: string; status: 'active' | 'inactive'; label: string }

const CHANNELS: Record<string, string> = { all: 'Todos os canais', funnel_chat: 'Chat do funil', whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', email: 'E-mail', sms: 'SMS' }
const STATUS: Record<ChannelAccount['status'], [string, string]> = { active: ['Ativa', 'text-emerald-400'], inactive: ['Pausada', 'text-slate-500'], error: ['Com erro', 'text-red-400'] }
const ERRORS: Record<string, string> = { FORBIDDEN: 'Seu acesso não permite alterar esta configuração.', NAME_TAKEN: 'Já existe um item com esse nome.', TAG_NAME_INVALID: 'Informe um nome de até 60 caracteres.', QUICK_REPLY_TITLE_INVALID: 'Informe um título de até 80 caracteres.', QUICK_REPLY_BODY_INVALID: 'Informe o texto da resposta (até 4000 caracteres).' }
const messageOf = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível salvar.' }
const input = 'h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40'
const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500'

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

  const tabs: [Tab, string, number][] = [['tags', 'Etiquetas', tags.length], ['replies', 'Respostas rápidas', replies.length], ...(canIntegrations ? [['channels', 'Canais', channels.length] as [Tab, string, number]] : [])]
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
      {!canConfigure && tab !== 'channels' && !loading && <p className="mb-4 text-xs text-slate-500">Somente leitura: alterar etiquetas e respostas exige a permissão de gerenciar automações.</p>}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
        {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-slate-500"><Loader2 size={18} className="animate-spin text-emerald-400" /> Carregando</div>
          : tab === 'tags' ? (tags.length ? tags.map(tag => <div key={tag.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{tag.name}</b>{inactive(tag.active)}{tag.description && <p className="truncate text-xs text-slate-500">{tag.description}</p>}</div>{canConfigure && editButton(tag.name, () => setEditor({ kind: 'tag', id: tag.id, name: tag.name, description: tag.description ?? '', active: tag.active }))}</div>) : empty('Nenhuma etiqueta. Etiquetas organizam conversas por assunto ou perfil.'))
          : tab === 'replies' ? (replies.length ? replies.map(reply => <div key={reply.id} className="flex items-start gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{reply.title}</b>{inactive(reply.active)}<span className="ml-2 text-[11px] text-slate-500">{CHANNELS[reply.channel] ?? reply.channel}</span><p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{reply.body}</p></div>{canConfigure && editButton(reply.title, () => setEditor({ kind: 'reply', id: reply.id, title: reply.title, body: reply.body, channel: reply.channel, active: reply.active }))}</div>) : empty('Nenhuma resposta rápida. Cadastre textos que a equipe envia com frequência.'))
          : channels.length ? channels.map(account => { const [statusLabel, tone] = STATUS[account.status]; const name = account.display_name || `${CHANNELS[account.channel] ?? account.channel} · ${account.provider}`; return <div key={account.id} className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0"><div className="min-w-0 flex-1"><b className="text-sm">{name}</b><span className={`ml-2 text-[11px] ${tone}`}>{statusLabel}</span><p className="truncate text-xs text-slate-500">{CHANNELS[account.channel] ?? account.channel} · {account.provider}{account.external_account_id ? ` · ${account.external_account_id}` : ''} · {account.credentials_ref ? 'credencial configurada' : 'sem credencial'}</p></div>{editButton(name, () => setEditor({ kind: 'channel', id: account.id, displayName: account.display_name ?? '', status: account.status === 'active' ? 'active' : 'inactive', label: name }))}</div> }) : empty('Nenhum canal conectado. A conexão de contas (e-mail, WhatsApp) é feita pela equipe Althea.')}
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
