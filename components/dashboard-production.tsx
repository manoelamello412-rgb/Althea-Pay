'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  Download,
  Filter,
  Gauge,
  GitBranch,
  RefreshCw,
  ShoppingCart,
  Wallet,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { CommandCenterOperations } from '@/components/command-center-operations'

type FilterKey = 'product' | 'funnel' | 'gateway' | 'status' | 'source' | 'campaign' | 'currency' | 'payment_method'
type Json = Record<string, any>

type RecentSale = {
  id: string
  amount: number | null
  currency: string | null
  status: string | null
  product_id: string | null
  gateway_id: string | null
  created_at: string
  occurred_at: string | null
  data: Json | null
}

const FILTERS: Array<[FilterKey, string]> = [
  ['product', 'Produto'],
  ['funnel', 'Funil'],
  ['gateway', 'Gateway'],
  ['status', 'Status'],
  ['source', 'Origem'],
  ['campaign', 'Campanha'],
  ['currency', 'Moeda'],
  ['payment_method', 'Método'],
]

const money = (value: any, currency = 'BRL') =>
  value == null
    ? 'R$ 0,00'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value))

const number = (value: any) => new Intl.NumberFormat('pt-BR').format(Number(value ?? 0))
const percent = (value: any) => value == null ? '—' : `${Number(value).toFixed(1).replace('.', ',')}%`
const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date)

const delta = (current: any, previous: any) => {
  const currentNumber = Number(current)
  const previousNumber = Number(previous)
  return Number.isFinite(currentNumber) && Number.isFinite(previousNumber) && previousNumber !== 0
    ? ((currentNumber - previousNumber) / Math.abs(previousNumber)) * 100
    : null
}

const saleStatus = (status: string | null) => {
  const normalized = String(status ?? '').toLowerCase()
  if (['approved', 'paid', 'completed', 'success', 'succeeded'].includes(normalized)) {
    return { label: 'Aprovada', className: 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#78d899]' }
  }
  if (['pending', 'processing', 'started'].includes(normalized)) {
    return { label: 'Pendente', className: 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]' }
  }
  if (['declined', 'failed', 'rejected', 'error'].includes(normalized)) {
    return { label: 'Recusada', className: 'border-red-400/15 bg-red-400/[.06] text-red-300' }
  }
  return { label: status || 'Sem status', className: 'border-white/[.07] bg-white/[.025] text-[var(--althea-muted)]' }
}

const textFrom = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : ''

function saleCustomer(sale: RecentSale) {
  const data = sale.data ?? {}
  const customer = data.customer && typeof data.customer === 'object' ? data.customer as Json : {}
  return textFrom(data.customer_name) || textFrom(data.name) || textFrom(customer.name) || textFrom(data.customer_email) || textFrom(data.email) || 'Cliente'
}

function saleProduct(sale: RecentSale) {
  const data = sale.data ?? {}
  return textFrom(data.product_name) || textFrom(data.product) || (sale.product_id ? `Produto ${sale.product_id.slice(0, 8)}` : 'Produto')
}

function saleGateway(sale: RecentSale) {
  const data = sale.data ?? {}
  return textFrom(data.gateway_name) || textFrom(data.gateway) || textFrom(data.provider) || (sale.gateway_id ? sale.gateway_id.slice(0, 8) : '—')
}

function TrendBadge({ current, previous }: { current: any; previous: any }) {
  const change = delta(current, previous)
  if (change === null) return <span className="text-[10px] font-medium text-[var(--althea-muted)]">Sem comparação</span>
  const positive = change >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${positive ? 'text-[#78d899]' : 'text-red-300'}`}>
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(change).toFixed(1).replace('.', ',')}%
    </span>
  )
}

export default function DashboardProduction() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const today = useMemo(() => localDate(new Date()), [])
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [data, setData] = useState<Json | null>(null)
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  const [displayName, setDisplayName] = useState('Usuário')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<Record<FilterKey, string>>({
    product: '',
    funnel: '',
    gateway: '',
    status: '',
    source: '',
    campaign: '',
    currency: '',
    payment_method: '',
  })

  const minDate = useMemo(() => {
    const date = new Date(`${today}T12:00:00`)
    date.setDate(date.getDate() - 89)
    return localDate(date)
  }, [today])

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data: auth }) => {
      if (!active || !auth.user) return
      const rawName =
        auth.user.user_metadata?.display_name ||
        auth.user.user_metadata?.full_name ||
        auth.user.email?.split('@')[0] ||
        'Usuário'
      setDisplayName(String(rawName).trim().split(/\s+/)[0] || 'Usuário')
    })
    return () => { active = false }
  }, [supabase])

  const load = useCallback(async (initial = false) => {
    if (!start || !end || start > end) {
      setError('O período informado é inválido.')
      return
    }

    initial ? setLoading(true) : setRefreshing(true)
    setError(null)

    const params = Object.fromEntries(
      Object.entries(selected).map(([key, value]) => [`p_${key}`, value || null]),
    )

    const [dashboardResult, recentResult] = await Promise.all([
      supabase.rpc('dashboard_production_data_for_user_secure', {
        p_start_date: start,
        p_end_date: end,
        ...params,
      }),
      supabase
        .from('sales')
        .select('id,amount,currency,status,product_id,gateway_id,created_at,occurred_at,data')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    if (dashboardResult.error) {
      setError(dashboardResult.error.message)
      setData(null)
    } else {
      setData((dashboardResult.data ?? {}) as Json)
    }

    if (!recentResult.error) {
      setRecentSales((recentResult.data ?? []) as RecentSale[])
    }

    initial ? setLoading(false) : setRefreshing(false)
  }, [end, selected, start, supabase])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    const channel = supabase.channel('dashboard-production')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_payment_attempts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => void load())
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [load, supabase])

  const d = data ?? {}
  const currency = selected.currency || 'BRL'
  const previousTicket = Number(d.previous?.sales) > 0
    ? Number(d.previous?.revenue ?? 0) / Number(d.previous?.sales)
    : null

  const cards = [
    {
      label: 'Faturamento',
      value: money(d.financial?.revenue, currency),
      current: d.financial?.revenue,
      previous: d.previous?.revenue,
      icon: Wallet,
      route: '/dashboard/pagamentos',
    },
    {
      label: 'Vendas',
      value: number(d.sales?.approved),
      current: d.sales?.approved,
      previous: d.previous?.sales,
      icon: ShoppingCart,
      route: '/dashboard/vendas',
    },
    {
      label: 'Aprovação',
      value: percent(d.gateways?.approvalRate),
      current: d.gateways?.approvalRate,
      previous: null,
      icon: Gauge,
      route: '/dashboard/gateways',
    },
    {
      label: 'Ticket médio',
      value: money(d.sales?.averageTicket, currency),
      current: d.sales?.averageTicket,
      previous: previousTicket,
      icon: CreditCard,
      route: '/dashboard/vendas',
    },
  ]

  const trend: any[] = Array.isArray(d.trend) ? d.trend : []
  const maxRevenue = Math.max(1, ...trend.map((item: any) => Number(item.revenue ?? 0)))
  const chartPoints = trend.map((item: any, index: number) => {
    const x = trend.length <= 1 ? 0 : (index / (trend.length - 1)) * 100
    const y = 90 - (Number(item.revenue ?? 0) / maxRevenue) * 72
    return { x, y, item }
  })
  const chartPath = chartPoints.length
    ? chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
    : ''
  const chartArea = chartPath
    ? `${chartPath} L 100 100 L 0 100 Z`
    : ''

  const paymentApproved = Number(d.payments?.approved ?? 0)
  const paymentPending = Number(d.payments?.pending ?? 0)
  const paymentDeclined = Number(d.payments?.declined ?? 0)
  const paymentTotal = paymentApproved + paymentPending + paymentDeclined
  const approvedShare = paymentTotal ? (paymentApproved / paymentTotal) * 100 : 0
  const pendingShare = paymentTotal ? (paymentPending / paymentTotal) * 100 : 0

  const clearFilters = () => setSelected({
    product: '',
    funnel: '',
    gateway: '',
    status: '',
    source: '',
    campaign: '',
    currency: '',
    payment_method: '',
  })

  const applyPreset = (days: number) => {
    const endDate = new Date(`${today}T12:00:00`)
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - (days - 1))
    setStart(localDate(startDate))
    setEnd(today)
  }

  const exportCsv = () => {
    const rows = [
      ['Métrica', 'Valor'],
      ['Faturamento', money(d.financial?.revenue, currency)],
      ['Vendas', number(d.sales?.approved)],
      ['Aprovação', percent(d.gateways?.approvalRate)],
      ['Ticket médio', money(d.sales?.averageTicket, currency)],
    ]
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `althea-dashboard-${start}-${end}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Revenue Operating System</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[36px]">
            Olá, {displayName} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-xs text-[var(--althea-muted)]">Controle operacional em tempo real e desempenho comercial da sua operação.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/[.06] bg-[var(--althea-surface)] p-1">
            <button type="button" onClick={() => applyPreset(1)} className="rounded-lg px-3 py-2 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white">Hoje</button>
            <button type="button" onClick={() => applyPreset(7)} className="rounded-lg px-3 py-2 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white">7 dias</button>
            <button type="button" onClick={() => applyPreset(30)} className="rounded-lg px-3 py-2 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white">30 dias</button>
          </div>
          <label className="flex items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-3 py-2 text-[10px] font-medium text-[var(--althea-muted)]">
            <input type="date" min={minDate} max={end} value={start} onChange={event => setStart(event.target.value)} className="w-[116px] bg-transparent text-white outline-none [color-scheme:dark]" />
            <span className="px-1 text-white/20">—</span>
            <input type="date" min={start} max={today} value={end} onChange={event => setEnd(event.target.value)} className="w-[116px] bg-transparent text-white outline-none [color-scheme:dark]" />
          </label>
          <button type="button" onClick={() => setFiltersOpen(value => !value)} className={`grid h-10 w-10 place-items-center rounded-xl border transition ${filtersOpen ? 'border-[rgba(29,184,84,.22)] bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white'}`} aria-label="Filtros"><Filter size={15} /></button>
          <button type="button" onClick={() => void load()} disabled={refreshing} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50" aria-label="Atualizar"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></button>
          <button type="button" onClick={exportCsv} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] transition hover:text-white" aria-label="Exportar CSV"><Download size={15} /></button>
        </div>
      </section>

      {filtersOpen && (
        <section className="rounded-2xl border border-white/[.06] bg-[var(--althea-surface)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Filtros do dashboard</p>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Os indicadores usam somente dados reais disponíveis para o usuário autenticado.</p>
            </div>
            <button type="button" onClick={() => setFiltersOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--althea-muted)] hover:bg-white/[.03] hover:text-white"><X size={15} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FILTERS.map(([key, label]) => (
              <label key={key} className="rounded-xl border border-white/[.05] bg-[var(--althea-bg)] p-3">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--althea-muted)]">{label}</span>
                <select value={selected[key]} onChange={event => setSelected(current => ({ ...current, [key]: event.target.value }))} className="mt-2 w-full bg-transparent text-xs text-white outline-none [color-scheme:dark]">
                  <option value="">Todos</option>
                  {(Array.isArray(d.filters?.[key]) ? d.filters[key] : []).map((value: any) => (
                    <option key={String(value)} value={String(value)}>{String(value)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button type="button" onClick={clearFilters} className="mt-3 text-[10px] font-semibold text-[var(--althea-brand)]">Limpar filtros</button>
        </section>
      )}

      {error && (
        <div className="rounded-2xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          Não foi possível atualizar o dashboard: {error}
        </div>
      )}

      <CommandCenterOperations />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map(item => <div key={item} className="h-[132px] animate-pulse rounded-2xl border border-white/[.05] bg-[var(--althea-surface)]" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map(({ label, value, current, previous, icon: Icon, route }) => (
              <button key={label} type="button" onClick={() => router.push(route)} className="group min-h-[132px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(29,184,84,.16)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-medium text-[var(--althea-muted)]">{label}</p>
                    <p className="mt-3 text-[24px] font-semibold tracking-[-.035em] text-white">{value}</p>
                  </div>
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
                </div>
                <div className="mt-4"><TrendBadge current={current} previous={previous} /></div>
              </button>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.7fr)]">
            <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Faturamento</h2>
                  <p className="mt-1 text-[10px] text-[var(--althea-muted)]">{start === end ? 'Hoje' : `${start} a ${end}`} · dados aprovados</p>
                </div>
                <Activity size={17} className="text-[var(--althea-brand)]" />
              </div>
              <div className="mt-4 flex items-end justify-between gap-4">
                <p className="text-[26px] font-semibold tracking-[-.04em] text-white">{money(d.financial?.revenue, currency)}</p>
                <TrendBadge current={d.financial?.revenue} previous={d.previous?.revenue} />
              </div>

              <div className="relative mt-5 h-[210px] overflow-hidden rounded-xl border border-white/[.035] bg-[var(--althea-bg)] px-3 pb-5 pt-3">
                {[22, 45, 68].map(line => <span key={line} className="absolute left-3 right-3 border-t border-dashed border-white/[.045]" style={{ top: `${line}%` }} />)}
                {chartPoints.length > 0 && chartPoints.some(point => Number(point.item.revenue ?? 0) > 0) ? (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="relative z-10 h-full w-full overflow-visible" aria-label="Gráfico de faturamento">
                    <defs>
                      <linearGradient id="altheaRevenueArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1DB854" stopOpacity="0.20" />
                        <stop offset="100%" stopColor="#1DB854" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={chartArea} fill="url(#altheaRevenueArea)" />
                    <path d={chartPath} fill="none" stroke="#1DB854" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <div className="relative z-10 grid h-full place-items-center text-center">
                    <div>
                      <Activity size={22} className="mx-auto text-[var(--althea-brand)] opacity-60" />
                      <p className="mt-2 text-[10px] text-[var(--althea-muted)]">O gráfico será preenchido quando houver faturamento no período.</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-2 flex justify-between text-[9px] text-[var(--althea-muted)]">
                <span>{trend[0]?.date || start}</span>
                <span>{trend.length ? trend[trend.length - 1]?.date : end}</span>
              </div>
            </article>

            <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Pagamentos</h2>
                <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Distribuição real dos status no período.</p>
              </div>

              <div className="mt-7 flex items-center gap-5">
                <div
                  className="relative grid h-[118px] w-[118px] shrink-0 place-items-center rounded-full"
                  style={{
                    background: paymentTotal
                      ? `conic-gradient(#1DB854 0 ${approvedShare}%, #D4AF37 ${approvedShare}% ${approvedShare + pendingShare}%, #C95C5C ${approvedShare + pendingShare}% 100%)`
                      : 'conic-gradient(#24332d 0 100%)',
                  }}
                >
                  <span className="absolute inset-[13px] rounded-full bg-[var(--althea-surface)]" />
                  <span className="relative text-xl font-semibold text-white">{number(paymentTotal)}</span>
                  <span className="absolute mt-9 text-[8px] text-[var(--althea-muted)]">transações</span>
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  {[
                    ['Aprovadas', paymentApproved, '#1DB854'],
                    ['Pendentes', paymentPending, '#D4AF37'],
                    ['Recusadas', paymentDeclined, '#C95C5C'],
                  ].map(([label, value, color]) => (
                    <div key={String(label)} className="grid grid-cols-[8px_1fr_auto] items-center gap-2 text-[10px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: String(color) }} />
                      <span className="truncate text-[var(--althea-muted)]">{label}</span>
                      <strong className="font-semibold text-white">{number(value)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <button type="button" onClick={() => router.push('/dashboard/pagamentos')} className="mt-7 w-full rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 py-2.5 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:border-[rgba(29,184,84,.16)] hover:text-white">
                Ver pagamentos
              </button>
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
            <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Transações recentes</h2>
                  <p className="mt-1 text-[10px] text-[var(--althea-muted)]">As últimas vendas registradas na sua conta.</p>
                </div>
                <button type="button" onClick={() => router.push('/dashboard/vendas')} className="text-[10px] font-semibold text-[var(--althea-brand)]">Ver todas</button>
              </div>

              {recentSales.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[650px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-white/[.05] text-[9px] font-medium text-[var(--althea-muted)]">
                        <th className="pb-3 pr-4 font-medium">Cliente</th>
                        <th className="pb-3 pr-4 font-medium">Produto</th>
                        <th className="pb-3 pr-4 font-medium">Gateway</th>
                        <th className="pb-3 pr-4 font-medium">Valor</th>
                        <th className="pb-3 pr-4 font-medium">Status</th>
                        <th className="pb-3 font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentSales.map(sale => {
                        const status = saleStatus(sale.status)
                        const occurred = new Date(sale.occurred_at || sale.created_at)
                        return (
                          <tr key={sale.id} className="border-b border-white/[.035] last:border-0">
                            <td className="py-3.5 pr-4 text-[10px] font-medium text-white">{saleCustomer(sale)}</td>
                            <td className="max-w-[180px] truncate py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{saleProduct(sale)}</td>
                            <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{saleGateway(sale)}</td>
                            <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(sale.amount, sale.currency || currency)}</td>
                            <td className="py-3.5 pr-4"><span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-semibold ${status.className}`}>{status.label}</span></td>
                            <td className="py-3.5 text-[9px] text-[var(--althea-muted)]">{Number.isNaN(occurred.getTime()) ? '—' : occurred.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-4 grid min-h-[190px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center">
                  <div className="max-w-[260px] px-5">
                    <ShoppingCart size={22} className="mx-auto text-[var(--althea-brand)] opacity-65" />
                    <p className="mt-3 text-xs font-medium text-white">Nenhuma transação ainda</p>
                    <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">Quando a primeira venda entrar, ela aparecerá aqui automaticamente.</p>
                  </div>
                </div>
              )}
            </article>

            <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Funis</h2>
                  <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Resumo dos funis conectados à operação.</p>
                </div>
                <GitBranch size={17} className="text-[var(--althea-brand)]" />
              </div>

              <div className="mt-5 space-y-2">
                {[
                  ['Funis ativos', number(d.funnels?.total)],
                  ['Visitas', number(d.funnels?.visits)],
                  ['Vendas', number(d.funnels?.sales)],
                  ['Conversão', d.funnels?.visits ? percent((Number(d.funnels?.sales ?? 0) / Number(d.funnels.visits)) * 100) : '—'],
                  ['Receita', money(d.funnels?.revenue, currency)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-xl border border-white/[.04] bg-[var(--althea-bg)] px-3 py-3">
                    <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
                    <strong className="text-[10px] font-semibold text-white">{value}</strong>
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => router.push('/dashboard/funil')} className="mt-4 w-full rounded-xl border border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.055)] px-3 py-2.5 text-[10px] font-semibold text-[var(--althea-brand)] transition hover:bg-[rgba(29,184,84,.09)]">
                Abrir funis
              </button>
            </article>
          </section>
        </>
      )}
    </div>
  )
}
