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
  if (normalized === 'approved') return 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]'
  if (normalized === 'pending') return 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]'
  if (['failed', 'cancelled', 'chargeback'].includes(normalized)) return 'border-red-400/15 bg-red-400/[.06] text-red-300'
  return 'border-white/[.06] bg-white/[.025] text-[var(--althea-muted)]'
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
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Operação comercial</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Vendas</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Acompanhe as transações reais registradas na operação, com filtros por período, status, cliente e gateway.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Receita aprovada" value={money(metrics.volume)} />
        <Metric label="Aprovadas" value={String(metrics.approved)} />
        <Metric label="Pendentes" value={String(metrics.pending)} />
        <Metric label="Falhas / canceladas" value={String(metrics.failed)} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_170px_190px]">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
            <Search size={14} className="shrink-0 text-[var(--althea-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, transação ou gateway..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]" />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
            <CalendarDays size={14} className="text-[var(--althea-muted)]" />
            <input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[10px] text-white outline-none [color-scheme:dark]" aria-label="Data inicial" />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
            <CalendarDays size={14} className="text-[var(--althea-muted)]" />
            <input type="date" value={endDate} min={startDate} max={today} onChange={(event) => setEndDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[10px] text-white outline-none [color-scheme:dark]" aria-label="Data final" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
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
            <div className="space-y-2">
              {[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] px-6 text-center">
              <div className="max-w-md">
                <CreditCard size={25} className="mx-auto text-[var(--althea-brand)] opacity-60" />
                <p className="mt-3 text-sm font-medium text-white">Nenhuma venda encontrada</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">
                  Quando transações reais forem registradas — ou quando os filtros encontrarem resultados — elas aparecerão aqui.
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[.05] text-[9px] text-[var(--althea-muted)]">
                  <th className="pb-3 pr-4 font-medium">Cliente</th>
                  <th className="pb-3 pr-4 font-medium">Transação</th>
                  <th className="pb-3 pr-4 font-medium">Gateway</th>
                  <th className="pb-3 pr-4 font-medium">Valor</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sale) => {
                  const data = obj(sale.data)
                  const customer = obj(data.customer)
                  return (
                    <tr key={sale.id} className="border-b border-white/[.035] last:border-0">
                      <td className="py-3.5 pr-4">
                        <p className="text-[10px] font-semibold text-white">{customerNameOf(sale)}</p>
                        <p className="mt-1 max-w-[220px] truncate text-[9px] text-[var(--althea-muted)]">{text(customer.email) || 'Contato não informado'}</p>
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-[9px] text-[var(--althea-muted)]">{sale.external_id || sale.transaction_id || sale.id.slice(0, 12)}</td>
                      <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{sale.gateway_id || '—'}</td>
                      <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(amountOf(sale))}</td>
                      <td className="py-3.5 pr-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-semibold ${statusClass(sale.status)}`}>{statusLabel(sale.status)}</span>
                      </td>
                      <td className="py-3.5 text-[9px] text-[var(--althea-muted)]">{new Date(sale.occurred_at ?? sale.created_at ?? '').toLocaleString('pt-BR')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
      <strong className="mt-4 block text-[24px] font-semibold tracking-[-.035em] text-white">{value}</strong>
    </article>
  )
}
