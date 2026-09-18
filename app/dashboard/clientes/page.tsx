'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Users, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Client = { id: string; data: Json | null; created_at: string; user_id: string }

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

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setClients([]); return }
      const result = await db.from('clients').select('id,data,created_at,user_id').order('created_at', { ascending: false }).limit(5000)
      if (result.error) throw result.error
      setClients((result.data ?? []) as Client[])
    } catch (cause) {
      console.error('[ALTHEA-CLIENTES]', cause)
      setError('Não foi possível carregar os clientes reais.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false
    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      channel = db.channel(`clients-${data.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `user_id=eq.${data.user.id}` }, () => void load()).subscribe()
    })
    return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  const rows = useMemo(() => clients.filter((client) => {
    if (!query.trim()) return true
    const data = obj(client.data)
    return [client.id, pick(data, ['name', 'full_name', 'nome', 'customer_name']), pick(data, ['email', 'buyer_email', 'customer_email']), pick(data, ['phone', 'whatsapp', 'mobile'])].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  }), [clients, query])

  const nameOf = (client: Client) => pick(obj(client.data), ['name', 'full_name', 'nome', 'customer_name']) || 'Cliente sem nome'
  const emailOf = (client: Client) => pick(obj(client.data), ['email', 'buyer_email', 'customer_email'])
  const phoneOf = (client: Client) => pick(obj(client.data), ['phone', 'whatsapp', 'mobile'])

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1700px]">
      <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // CLIENTES</div><h1 className="text-3xl font-black tracking-tight">Clientes</h1><p className="mt-1 text-sm text-slate-500">Base de clientes operacional, sincronizada com o CRM.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Sincronizar</button></header>
      <section className="mb-5 grid gap-3 sm:grid-cols-3"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Clientes</span><strong className="mt-2 block text-2xl font-black">{clients.length}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Com e-mail</span><strong className="mt-2 block text-2xl font-black">{clients.filter(emailOf).length}</strong></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Com telefone</span><strong className="mt-2 block text-2xl font-black">{clients.filter(phoneOf).length}</strong></article></section>
      <label className="mb-5 flex h-11 max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-white/[.025] px-3 text-slate-500"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="Buscar nome, e-mail, telefone ou ID..." /></label>
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]"><div className="hidden grid-cols-[minmax(240px,1.4fr)_minmax(220px,1fr)_180px_120px] border-b border-white/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-600 md:grid"><span>Cliente</span><span>Contato</span><span>Telefone</span><span>Cadastro</span></div>{loading ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><RefreshCw size={22} className="animate-spin text-emerald-400" /><strong>Carregando clientes</strong><p className="text-sm text-slate-600">Sincronizando dados reais.</p></div> : error ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><X size={22} className="text-red-400" /><strong>Falha na sincronização</strong><p className="text-sm text-slate-500">{error}</p><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Tentar novamente</button></div> : rows.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><Users size={24} className="text-slate-600" /><strong>Nenhum cliente encontrado</strong><p className="text-sm text-slate-600">{clients.length ? 'Ajuste a busca para encontrar o cliente.' : 'Os clientes aparecerão aqui quando forem recebidos pelos seus fluxos.'}</p></div> : <div>{rows.map(client => <button key={client.id} type="button" onClick={() => setSelected(client)} className="grid w-full grid-cols-1 gap-2 border-b border-white/[.06] px-5 py-4 text-left transition hover:bg-white/[.035] md:grid-cols-[minmax(240px,1.4fr)_minmax(220px,1fr)_180px_120px] md:items-center"><span className="min-w-0"><b className="block truncate text-sm text-slate-100">{nameOf(client)}</b><small className="block truncate pt-1 text-[11px] text-slate-600">{client.id}</small></span><span className="truncate text-sm text-slate-400">{emailOf(client) || '—'}</span><span className="text-sm text-slate-400">{phoneOf(client) || '—'}</span><span className="text-xs text-slate-500">{date(client.created_at)}</span></button>)}</div>}</section>
    </div>
    {selected && <div role="dialog" aria-modal="true" aria-label="Detalhes do cliente" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setSelected(null) }}><div className="w-full max-w-xl rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 shadow-2xl md:rounded-3xl"><div className="mb-6 flex items-center justify-between"><div><span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Customer 360</span><h2 className="mt-1 text-xl font-black">{nameOf(selected)}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 p-4"><span className="text-[10px] uppercase tracking-widest text-slate-600">E-mail</span><b className="mt-2 block break-all text-sm">{emailOf(selected) || 'Não informado'}</b></div><div className="rounded-xl border border-white/10 p-4"><span className="text-[10px] uppercase tracking-widest text-slate-600">Telefone</span><b className="mt-2 block text-sm">{phoneOf(selected) || 'Não informado'}</b></div><div className="rounded-xl border border-white/10 p-4 sm:col-span-2"><span className="text-[10px] uppercase tracking-widest text-slate-600">ID do cliente</span><b className="mt-2 block break-all font-mono text-xs">{selected.id}</b></div></div><div className="mt-4 rounded-xl border border-white/10 p-4"><span className="text-[10px] uppercase tracking-widest text-slate-600">Cadastro</span><b className="mt-2 block text-sm">{date(selected.created_at)}</b></div></div></div>}
  </main>
}
