'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListPlus, Loader2, RefreshCw, Search, Users, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { loadOrganizationAccess } from '@/lib/auth/organization-access'

type Json = Record<string, unknown>
type Client = { id: string; data: Json | null; created_at: string; user_id: string }
type ContactList = { id: string; name: string }

const obj = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
const pick = (data: Json, keys: string[]) => { for (const key of keys) { const value = text(data[key]); if (value) return value } for (const parent of ['customer', 'buyer', 'profile']) { const nested = obj(data[parent]); for (const key of keys) { const value = text(nested[key]); if (value) return value } } return '' }
const date = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d) }

export default function ClientesPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Client | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [lists, setLists] = useState<ContactList[]>([])
  const [listDialog, setListDialog] = useState<{ listId: string; name: string; saving: boolean; result: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setClients([]); return }
      const { organization_id: organizationId } = await loadOrganizationAccess(db)
      const result = await db.from('clients').select('id,data,created_at,user_id').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(5000)
      if (result.error) throw result.error
      setClients((result.data ?? []) as Client[])
      const listResult = await db.from('crm_contact_lists').select('id,name').eq('organization_id', organizationId).order('name')
      if (!listResult.error) setLists((listResult.data ?? []) as ContactList[])
    } catch (cause) {
      console.error('[ALTHEA-CLIENTES]', cause)
      setError('Não foi possível carregar os clientes reais.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false
    void loadOrganizationAccess(db).then(({ organization_id: org }) => {
      if (cancelled) return
      channel = db.channel(`clients-${org}`).on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `organization_id=eq.${org}` }, () => void load()).subscribe()
    }).catch(() => undefined)
    return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  const rows = useMemo(() => clients.filter((client) => {
    if (!query.trim()) return true
    const data = obj(client.data)
    return [client.id, pick(data, ['name', 'full_name', 'nome', 'customer_name']), pick(data, ['email', 'buyer_email', 'customer_email']), pick(data, ['phone', 'whatsapp', 'mobile'])].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  }), [clients, query])

  const toggle = (id: string) => setChecked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const allChecked = rows.length > 0 && rows.every(client => checked.has(client.id))
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rows.map(client => client.id)))

  async function addToList() {
    if (!listDialog) return
    setListDialog({ ...listDialog, saving: true, result: '' })
    const { data, error: rpcError } = await db.rpc('crm_contact_list_add', { p_list_id: listDialog.listId || null, p_name: listDialog.listId ? null : listDialog.name, p_client_ids: [...checked] })
    if (rpcError) { setListDialog({ ...listDialog, saving: false, result: rpcError.message === 'FORBIDDEN' ? 'Seu acesso não permite montar listas (exige gerenciar automações).' : 'Não foi possível salvar a lista.' }); return }
    const saved = data as { id: string; name: string; added: number }
    setLists(current => current.some(list => list.id === saved.id) ? current : [...current, { id: saved.id, name: saved.name }].sort((a, b) => a.name.localeCompare(b.name)))
    setChecked(new Set())
    setListDialog({ listId: saved.id, name: '', saving: false, result: `${saved.added} cliente(s) adicionado(s) à lista "${saved.name}". Use-a em CRM › Campanhas.` })
  }

  const nameOf = (client: Client) => pick(obj(client.data), ['name', 'full_name', 'nome', 'customer_name']) || 'Cliente sem nome'
  const emailOf = (client: Client) => pick(obj(client.data), ['email', 'buyer_email', 'customer_email'])
  const phoneOf = (client: Client) => pick(obj(client.data), ['phone', 'whatsapp', 'mobile'])

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1700px]">
      <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // CLIENTES</div><h1 className="text-3xl font-black tracking-tight">Clientes</h1><p className="mt-1 text-sm text-slate-500">Base de clientes operacional, sincronizada com o CRM.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Sincronizar</button></header>
      <section className="mb-5 grid gap-3 sm:grid-cols-3"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Clientes</span><strong className="mt-2 block text-2xl font-black">{clients.length}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Com e-mail</span><strong className="mt-2 block text-2xl font-black">{clients.filter(emailOf).length}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Com telefone</span><strong className="mt-2 block text-2xl font-black">{clients.filter(phoneOf).length}</strong></article></section>
      <label className="mb-5 flex h-11 max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-white/[.025] px-3 text-slate-500"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="Buscar nome, e-mail, telefone ou ID..." /></label>
      {checked.size > 0 && <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-[#0b100e] px-4 py-2.5 text-sm"><b>{checked.size} selecionado(s)</b><button type="button" onClick={() => setListDialog({ listId: lists[0]?.id ?? '', name: '', saving: false, result: '' })} className="inline-flex h-8 items-center gap-2 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-black hover:bg-emerald-400"><ListPlus size={14} /> Adicionar à lista</button><button type="button" onClick={() => setChecked(new Set())} className="text-xs text-slate-400 hover:text-white">Limpar seleção</button></div>}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]"><div className="hidden grid-cols-[28px_minmax(240px,1.4fr)_minmax(220px,1fr)_180px_120px] items-center border-b border-white/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-600 lg:grid"><input type="checkbox" aria-label="Selecionar todos os clientes listados" checked={allChecked} onChange={toggleAll} className="accent-emerald-500" /><span>Cliente</span><span>Contato</span><span>Telefone</span><span>Cadastro</span></div>{loading ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><RefreshCw size={22} className="animate-spin text-emerald-400" /><strong>Carregando clientes</strong><p className="text-sm text-slate-600">Sincronizando dados reais.</p></div> : error ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><X size={22} className="text-red-400" /><strong>Falha na sincronização</strong><p className="text-sm text-slate-500">{error}</p><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Tentar novamente</button></div> : rows.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><Users size={24} className="text-slate-600" /><strong>Nenhum cliente encontrado</strong><p className="text-sm text-slate-600">{clients.length ? 'Ajuste a busca para encontrar o cliente.' : 'Os clientes aparecerão aqui quando forem recebidos pelos seus fluxos.'}</p></div> : <div>{rows.map(client => <div key={client.id} className={`flex items-center gap-3 border-b border-white/[.06] pl-5 ${checked.has(client.id) ? 'bg-emerald-500/[.04]' : ''}`}><input type="checkbox" aria-label={`Selecionar ${nameOf(client)}`} checked={checked.has(client.id)} onChange={() => toggle(client.id)} className="h-4 w-4 shrink-0 accent-emerald-500" /><button type="button" onClick={() => setSelected(client)} className="grid min-w-0 flex-1 grid-cols-1 gap-2 py-4 pr-5 text-left transition hover:bg-white/[.035] lg:grid-cols-[minmax(240px,1.4fr)_minmax(220px,1fr)_180px_120px] lg:items-center"><span className="min-w-0"><b className="block truncate text-sm text-slate-100">{nameOf(client)}</b><small className="block truncate pt-1 text-[11px] text-slate-600">{client.id}</small></span><span className="truncate text-sm text-slate-400">{emailOf(client) || '—'}</span><span className="text-sm text-slate-400">{phoneOf(client) || '—'}</span><span className="text-xs text-slate-500">{date(client.created_at)}</span></button></div>)}</div>}</section>
    </div>
    {listDialog && <div role="dialog" aria-modal="true" aria-label="Adicionar à lista" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setListDialog(null) }}><div className="w-full max-w-md space-y-4 rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
      <div className="flex items-center justify-between"><h2 className="text-lg font-black">Adicionar à lista</h2><button type="button" onClick={() => setListDialog(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
      {listDialog.result ? <p role="status" className="text-sm text-slate-300">{listDialog.result}</p> : <>
        <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Lista</span><select value={listDialog.listId} onChange={event => setListDialog({ ...listDialog, listId: event.target.value })} className="h-10 w-full rounded-xl border border-white/10 bg-[#0b100e] px-3 text-sm outline-none focus:border-emerald-500/40">{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}<option value="">+ Nova lista</option></select></label>
        {!listDialog.listId && <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Nome da nova lista</span><input value={listDialog.name} maxLength={80} autoFocus onChange={event => setListDialog({ ...listDialog, name: event.target.value })} className="h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40" /></label>}
        <p className="text-xs text-slate-500">{checked.size} cliente(s). Só recebem WhatsApp os que têm telefone e não pediram para sair.</p>
        <button type="button" onClick={() => void addToList()} disabled={listDialog.saving || (!listDialog.listId && !listDialog.name.trim())} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{listDialog.saving && <Loader2 size={15} className="animate-spin" />} Adicionar</button>
      </>}
    </div></div>}
    {selected && <div role="dialog" aria-modal="true" aria-label="Detalhes do cliente" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setSelected(null) }}><div className="w-full max-w-xl rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 shadow-2xl md:rounded-3xl"><div className="mb-6 flex items-center justify-between"><div><span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Customer 360</span><h2 className="mt-1 text-xl font-black">{nameOf(selected)}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 p-4"><span className="text-[10px] uppercase tracking-widest text-slate-600">E-mail</span><b className="mt-2 block break-all text-sm">{emailOf(selected) || 'Não informado'}</b></div><div className="rounded-xl border border-white/10 p-4"><span className="text-[10px] uppercase tracking-widest text-slate-600">Telefone</span><b className="mt-2 block text-sm">{phoneOf(selected) || 'Não informado'}</b></div><div className="rounded-xl border border-white/10 p-4 sm:col-span-2"><span className="text-[10px] uppercase tracking-widest text-slate-600">ID do cliente</span><b className="mt-2 block break-all font-mono text-xs">{selected.id}</b></div></div><div className="mt-4 rounded-xl border border-white/10 p-4"><span className="text-[10px] uppercase tracking-widest text-slate-600">Cadastro</span><b className="mt-2 block text-sm">{date(selected.created_at)}</b></div></div></div>}
  </main>
}
