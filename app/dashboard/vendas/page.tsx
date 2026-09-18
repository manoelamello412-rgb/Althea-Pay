'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CreditCard, RefreshCw, Search } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { amountOf, customerNameOf, dateOf, normalizeStatus, todayInSaoPaulo, type AnalyticsSale } from '@/lib/analytics/sales'

type Sale = AnalyticsSale & { currency?: string | null }
type JsonObject = Record<string, unknown>

const obj = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : String(value)

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

const statusLabel = (value: string | null) => {
  const normalized = normalizeStatus(value)
  return ({
    approved: 'Aprovada',
    pending: 'Pendente',
    failed: 'Falhou',
    cancelled: 'Cancelada',
    refunded: 'Reembolsada',
    chargeback: 'Chargeback',
  } as Record<string, string>)[normalized] ?? normalized
}

const statusClass = (value: string | null) => {
  const normalized = normalizeStatus(value)
  if (normalized === 'approved') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
  if (normalized === 'pending') return 'border-amber-400/20 bg-amber-400/10 text-amber-300'
  if (['failed', 'cancelled', 'chargeback'].includes(normalized)) return 'border-rose-400/20 bg-rose-400/10 text-rose-300'
  return 'border-white/10 bg-white/[0.04] text-zinc-300'
}

function shiftDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00-03:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export default function VendasPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const today = todayInSaoPaulo()
  const [sales, setSales] = useState<Sale[]>([])
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [startDate, setStartDate] = useState(shiftDays(today, -29))
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: auth, error: authError } = await db.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('default_organization_id')
      .eq('id', auth.user.id)
      .single()

    if (profileError || !profile?.default_organization_id) {
      throw new Error('Organização ativa não encontrada para esta conta.')
    }

    const activeOrganizationId = String(profile.default_organization_id)
    setOrganizationId(activeOrganizationId)

    const result = await db
      .from('sales')
      .select('id,amount,status,currency,data,gateway_id,external_id,transaction_id,occurred_at,created_at')
      .eq('organization_id', activeOrganizationId)
      .order('occurred_at', { ascending: false })
      .limit(5000)

    if (result.error) throw result.error
    setSales((result.data ?? []) as Sale[])
  }, [db])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as vendas.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!organizationId) return
    let active = true
    const channel = db
      .channel(`sales-dashboard-${organizationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sales',
        filter: `organization_id=eq.${organizationId}`,
      }, () => { if (active) void load() })
      .subscribe()

    return () => {
      active = false
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return sales.filter((sale) => {
      const day = dateOf(sale)
      if (day && (day < startDate || day > endDate)) return false
      const normalizedStatus = normalizeStatus(sale.status)
      if (status !== 'all' && normalizedStatus !== status) return false
      if (!normalizedQuery) return true
      const data = obj(sale.data)
      const customer = obj(data.customer)
      return [
        sale.id,
        sale.external_id,
        sale.transaction_id,
        sale.gateway_id,
        customerNameOf(sale),
        text(customer.email),
        text(customer.phone),
      ].join(' ').toLowerCase().includes(normalizedQuery)
    })
  }, [endDate, query, sales, startDate, status])

  const metrics = useMemo(() => {
    const approved = filtered.filter((sale) => normalizeStatus(sale.status) === 'approved')
    const pending = filtered.filter((sale) => normalizeStatus(sale.status) === 'pending')
    const failed = filtered.filter((sale) => ['failed', 'cancelled'].includes(normalizeStatus(sale.status)))
    return {
      volume: approved.reduce((sum, sale) => sum + amountOf(sale), 0),
      approved: approved.length,
      pending: pending.length,
      failed: failed.length,
    }
  }, [filtered])

  return (
    <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // VENDAS</p>
            <h1 className="text-3xl font-black tracking-tight">Vendas</h1>
            <p className="mt-1 text-sm text-slate-500">Transações reais registradas pela operação. Nenhum dado é simulado.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm font-semibold hover:bg-white/[.06] disabled:opacity-50">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Sincronizar
          </button>
        </header>

        {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Receita aprovada" value={money(metrics.volume)} />
          <Metric label="Aprovadas" value={String(metrics.approved)} />
          <Metric label="Pendentes" value={String(metrics.pending)} />
          <Metric label="Falhas / canceladas" value={String(metrics.failed)} />
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[.02] p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_170px_190px]">
            <label className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
              <Search size={16} className="shrink-0 text-slate-500" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, transação ou gateway..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
            </label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
              <CalendarDays size={15} className="text-slate-500" />
              <input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none [color-scheme:dark]" aria-label="Data inicial" />
            </label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
              <CalendarDays size={15} className="text-slate-500" />
              <input type="date" value={endDate} min={startDate} max={today} onChange={(event) => setEndDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none [color-scheme:dark]" aria-label="Data final" />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 rounded-xl border border-white/10 bg-[#111513] px-3 text-sm text-white outline-none">
              <option value="all">Todos os status</option>
              <option value="approved">Aprovadas</option>
              <option value="pending">Pendentes</option>
              <option value="failed">Falhas</option>
              <option value="cancelled">Canceladas</option>
              <option value="refunded">Reembolsadas</option>
              <option value="chargeback">Chargebacks</option>
            </select>
          </div>

          <div className="mt-5 overflow-x-auto">
            {loading ? (
              <div className="space-y-3 py-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-white/[.03]" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-6 text-center">
                <CreditCard size={26} className="mb-3 text-slate-600" />
                <p className="text-sm font-semibold text-white">Nenhuma venda encontrada</p>
                <p className="mt-1 max-w-md text-xs text-slate-600">Quando transações reais forem registradas — ou quando os filtros encontrarem resultados — elas aparecerão aqui.</p>
              </div>
            ) : (
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[.06] text-[10px] font-bold uppercase tracking-[.16em] text-slate-600">
                    <th className="px-3 py-3">Cliente</th>
                    <th className="px-3 py-3">Transação</th>
                    <th className="px-3 py-3">Gateway</th>
                    <th className="px-3 py-3">Valor</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sale) => {
                    const data = obj(sale.data)
                    const customer = obj(data.customer)
                    return (
                      <tr key={sale.id} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.02]">
                        <td className="px-3 py-4">
                          <p className="font-medium text-white">{customerNameOf(sale)}</p>
                          <p className="mt-0.5 text-xs text-slate-600">{text(customer.email) || 'Contato não informado'}</p>
                        </td>
                        <td className="px-3 py-4 font-mono text-xs text-slate-400">{sale.external_id || sale.transaction_id || sale.id.slice(0, 12)}</td>
                        <td className="px-3 py-4 text-slate-400">{sale.gateway_id || '—'}</td>
                        <td className="px-3 py-4 font-semibold text-white">{money(amountOf(sale))}</td>
                        <td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(sale.status)}`}>{statusLabel(sale.status)}</span></td>
                        <td className="px-3 py-4 text-xs text-slate-500">{new Date(sale.occurred_at ?? sale.created_at ?? '').toLocaleString('pt-BR')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span><strong className="mt-2 block text-2xl font-black">{value}</strong></article>
}
