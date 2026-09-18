'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mail, Phone, RefreshCw, Search, Users, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Client = { id: string; data: Json | null; created_at: string; user_id: string }

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value)

const pick = (data: Json, keys: string[]) => {
  for (const key of keys) {
    const value = text(data[key])
    if (value) return value
  }
  for (const parent of ['customer', 'buyer', 'profile']) {
    const nested = obj(data[parent])
    for (const key of keys) {
      const value = text(nested[key])
      if (value) return value
    }
  }
  return ''
}

const date = (value: string) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(parsed)
}

export default function ClientesPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Client | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) {
        setClients([])
        return
      }

      const result = await db
        .from('clients')
        .select('id,data,created_at,user_id')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(5000)

      if (result.error) throw result.error
      setClients((result.data ?? []) as Client[])
    } catch (cause) {
      console.error('[ALTHEA-CLIENTES]', cause)
      setError('Não foi possível carregar os clientes reais.')
    } finally {
      setLoading(false)
    }
  }, [db])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false

    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      channel = db
        .channel(`clients-${data.user.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'clients',
          filter: `user_id=eq.${data.user.id}`,
        }, () => void load())
        .subscribe()
    })

    return () => {
      cancelled = true
      if (channel) void db.removeChannel(channel)
    }
  }, [db, load])

  const nameOf = (client: Client) =>
    pick(obj(client.data), ['name', 'full_name', 'nome', 'customer_name']) || 'Cliente sem nome'

  const emailOf = (client: Client) =>
    pick(obj(client.data), ['email', 'buyer_email', 'customer_email'])

  const phoneOf = (client: Client) =>
    pick(obj(client.data), ['phone', 'whatsapp', 'mobile'])

  const rows = useMemo(() => clients.filter((client) => {
    if (!query.trim()) return true
    const data = obj(client.data)
    return [
      client.id,
      pick(data, ['name', 'full_name', 'nome', 'customer_name']),
      pick(data, ['email', 'buyer_email', 'customer_email']),
      pick(data, ['phone', 'whatsapp', 'mobile']),
    ].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  }), [clients, query])

  const withEmail = useMemo(() => clients.filter(emailOf).length, [clients])
  const withPhone = useMemo(() => clients.filter(phoneOf).length, [clients])

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Relacionamento</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Clientes</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Consulte a base real de clientes recebida pelos seus fluxos e sincronizada com o CRM.
          </p>
        </div>

        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric icon={Users} label="Clientes" value={String(clients.length)} />
        <Metric icon={Mail} label="Com e-mail" value={String(withEmail)} />
        <Metric icon={Phone} label="Com telefone" value={String(withPhone)} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <label className="flex h-10 max-w-xl items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
          <Search size={14} className="text-[var(--althea-muted)]" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]"
            placeholder="Buscar nome, e-mail, telefone ou ID..."
          />
        </label>

        <div className="mt-5 overflow-hidden rounded-xl border border-white/[.045] bg-[var(--althea-bg)]">
          <div className="hidden grid-cols-[minmax(240px,1.4fr)_minmax(220px,1fr)_180px_120px] border-b border-white/[.045] px-4 py-3 text-[9px] text-[var(--althea-muted)] md:grid">
            <span>Cliente</span>
            <span>Contato</span>
            <span>Telefone</span>
            <span>Cadastro</span>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map(item => <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--althea-surface)]" />)}
            </div>
          ) : error ? (
            <div className="grid min-h-[240px] place-items-center px-5 text-center">
              <div>
                <X size={22} className="mx-auto text-red-300" />
                <p className="mt-3 text-sm font-medium text-white">Falha na sincronização</p>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">{error}</p>
                <button type="button" onClick={() => void load()} className="mt-4 rounded-xl border border-white/[.06] px-3 py-2 text-[10px] text-[var(--althea-muted)] hover:text-white">
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="grid min-h-[240px] place-items-center px-5 text-center">
              <div className="max-w-sm">
                <Users size={24} className="mx-auto text-[var(--althea-brand)] opacity-60" />
                <p className="mt-3 text-sm font-medium text-white">Nenhum cliente encontrado</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">
                  {clients.length ? 'Ajuste a busca para encontrar outro cliente.' : 'Os clientes aparecerão aqui quando forem recebidos pelos seus fluxos.'}
                </p>
              </div>
            </div>
          ) : (
            <div>
              {rows.map(client => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelected(client)}
                  className="grid w-full grid-cols-1 gap-2 border-b border-white/[.035] px-4 py-3.5 text-left transition last:border-0 hover:bg-white/[.02] md:grid-cols-[minmax(240px,1.4fr)_minmax(220px,1fr)_180px_120px] md:items-center"
                >
                  <span className="min-w-0">
                    <b className="block truncate text-[10px] font-semibold text-white">{nameOf(client)}</b>
                    <small className="mt-1 block truncate text-[8px] text-[var(--althea-muted)]">{client.id}</small>
                  </span>
                  <span className="truncate text-[10px] text-[var(--althea-muted)]">{emailOf(client) || '—'}</span>
                  <span className="text-[10px] text-[var(--althea-muted)]">{phoneOf(client) || '—'}</span>
                  <span className="text-[9px] text-[var(--althea-muted)]">{date(client.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Detalhes do cliente"
          className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={event => { if (event.currentTarget === event.target) setSelected(null) }}
        >
          <div className="w-full max-w-xl rounded-t-3xl border border-white/[.07] bg-[var(--althea-surface)] p-6 shadow-2xl md:rounded-3xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-[.18em] text-[var(--althea-brand)]">Customer 360</span>
                <h2 className="mt-1 text-xl font-semibold text-white">{nameOf(selected)}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-lg text-[var(--althea-muted)] hover:bg-white/[.03] hover:text-white">
                <X size={17} />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['E-mail', emailOf(selected) || 'Não informado'],
                ['Telefone', phoneOf(selected) || 'Não informado'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4">
                  <span className="text-[9px] text-[var(--althea-muted)]">{label}</span>
                  <b className="mt-2 block break-all text-xs font-medium text-white">{value}</b>
                </div>
              ))}
              <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4 sm:col-span-2">
                <span className="text-[9px] text-[var(--althea-muted)]">ID do cliente</span>
                <b className="mt-2 block break-all font-mono text-[10px] text-white">{selected.id}</b>
              </div>
              <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4 sm:col-span-2">
                <span className="text-[9px] text-[var(--althea-muted)]">Cadastro</span>
                <b className="mt-2 block text-xs font-medium text-white">{date(selected.created_at)}</b>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
        <Icon size={15} className="text-[var(--althea-brand)]" />
      </div>
      <strong className="mt-4 block text-[24px] font-semibold tracking-[-.035em] text-white">{value}</strong>
    </article>
  )
}
