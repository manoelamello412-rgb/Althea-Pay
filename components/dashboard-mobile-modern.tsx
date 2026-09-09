'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BarChart3,
  CheckCircle2,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  Filter,
  RefreshCw,
  ShoppingCart,
  Ticket,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Sale = {
  id: string
  amount: number | string | null
  status?: string | null
  payment_method?: string | null
  paymentMethod?: string | null
  customer_id?: string | null
  data?: Record<string, unknown> | null
  gateway_id?: string | null
  occurred_at?: string | null
  created_at?: string | null
}

type RangeDays = 7 | 30 | 90

type Range = {
  start: string
  end: string
}

type MetricCardProps = {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  loading: boolean
  masked: boolean
  accent?: boolean
}

type RecentSaleProps = {
  sale: Sale
  masked: boolean
}

const TIME_ZONE = 'America/Sao_Paulo'
const APPROVED = new Set(['approved', 'completed', 'paid', 'success', 'succeeded', 'authorized'])
const PENDING = new Set(['pending', 'processing', 'waiting', 'waiting_payment', 'in_review', 'in_analysis'])
const RANGE_OPTIONS: Array<{ value: RangeDays; label: string }> = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
]

const getToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const parseDate = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const isoDate = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const addDays = (value: string, amount: number): string => {
  const date = parseDate(value)
  date.setDate(date.getDate() + amount)
  return isoDate(date)
}

const formatMoney = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)

const formatDate = (value: string): string =>
  parseDate(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const amountOf = (sale: Sale): number => {
  const value = sale.amount ?? sale.data?.amount ?? 0
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

const dateOf = (sale: Sale): string => {
  const source = sale.occurred_at || sale.created_at || ''
  return source.slice(0, 10)
}

const statusOf = (sale: Sale): string => String(sale.status ?? '').trim().toLowerCase()

const isApproved = (sale: Sale): boolean => APPROVED.has(statusOf(sale))
const isPending = (sale: Sale): boolean => PENDING.has(statusOf(sale))

const customerLabel = (sale: Sale): string => {
  const data = sale.data ?? {}
  const customer = data.customer
  const customerRecord = customer && typeof customer === 'object'
    ? customer as Record<string, unknown>
    : null

  const name = data.customer_name ?? data.name ?? customerRecord?.name ?? customerRecord?.full_name
  if (typeof name === 'string' && name.trim()) return name.trim()

  const email = data.customer_email ?? data.email ?? customerRecord?.email
  if (typeof email === 'string' && email.trim()) return email.trim()

  return sale.customer_id ? `Cliente ${sale.customer_id.slice(0, 6).toUpperCase()}` : 'Cliente'
}

const paymentLabel = (sale: Sale): string => {
  const data = sale.data ?? {}
  const method = sale.payment_method ?? sale.paymentMethod ?? data.payment_method ?? data.paymentMethod
  const normalized = String(method ?? '').trim().toLowerCase()

  if (normalized.includes('pix')) return 'PIX'
  if (normalized.includes('credit') || normalized.includes('card') || normalized.includes('cart')) return 'Cartão'
  if (normalized.includes('boleto')) return 'Boleto'
  if (normalized) return String(method)
  return 'Pagamento'
}

function MetricCard({ label, value, detail, icon: Icon, loading, masked, accent = false }: MetricCardProps) {
  return (
    <article
      className={`group relative min-w-0 overflow-hidden rounded-[18px] border p-4 shadow-[0_14px_50px_rgba(0,0,0,.18)] transition-colors duration-200 ${
        accent
          ? 'border-[#1DB854]/30 bg-[linear-gradient(145deg,#0e1713,#0b0d0c)]'
          : 'border-white/[0.07] bg-[#0c0d0e]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7d8984]">{label}</span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#1DB854]/15 bg-[#0f1713] text-[#1DB854] transition-transform duration-200 group-hover:scale-105">
          <Icon size={16} strokeWidth={1.9} />
        </span>
      </div>

      {loading ? (
        <div className="mt-4 h-7 w-24 animate-pulse rounded-md bg-white/[0.06]" aria-hidden="true" />
      ) : (
        <strong className="mt-4 block truncate text-[25px] font-semibold leading-none tracking-[-0.04em] text-white">
          {masked ? '••••••' : value}
        </strong>
      )}

      <span className="mt-2 block truncate text-[10px] text-[#737d79]">{detail}</span>
    </article>
  )
}

function RecentSale({ sale, masked }: RecentSaleProps) {
  const approved = isApproved(sale)
  const pending = isPending(sale)
  const statusLabel = approved ? 'Aprovada' : pending ? 'Pendente' : 'Processando'
  const StatusIcon = approved ? CheckCircle2 : Clock3

  return (
    <div className="flex items-center gap-3 border-b border-white/[0.045] py-3.5 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-[#111413] text-[#1DB854]">
        <ShoppingCart size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-zinc-100">{customerLabel(sale)}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[9px] text-[#737d79]">
          <span className="truncate">{paymentLabel(sale)}</span>
          <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[#4b5551]" />
          <span className="shrink-0">{formatDateTime(sale.occurred_at || sale.created_at)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-semibold text-white">{masked ? '••••' : formatMoney(amountOf(sale))}</p>
        <span className={`mt-1 inline-flex items-center gap-1 text-[9px] ${approved ? 'text-[#1DB854]' : 'text-[#9ca7a2]'}`}>
          <StatusIcon size={10} />
          {statusLabel}
        </span>
      </div>
    </div>
  )
}

export default function DashboardMobileModern() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showValues, setShowValues] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const range = useMemo<Range>(() => {
    const end = getToday()
    return {
      start: addDays(end, -(rangeDays - 1)),
      end,
    }
  }, [rangeDays])

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError) throw authError

      if (!auth.user) {
        setSales([])
        setLastUpdated(new Date())
        return
      }

      const since = addDays(getToday(), -89)
      const { data, error: salesError } = await db
        .from('sales')
        .select('id,amount,status,payment_method,paymentMethod,customer_id,data,gateway_id,occurred_at,created_at')
        .eq('user_id', auth.user.id)
        .gte('created_at', `${since}T00:00:00-03:00`)
        .order('created_at', { ascending: false })
        .limit(5000)

      if (salesError) throw salesError

      setSales((data ?? []) as Sale[])
      setLastUpdated(new Date())
    } catch (cause) {
      console.error('[ALTHEA-DASHBOARD]', cause)
      setError('Não foi possível sincronizar os dados agora.')
    } finally {
      if (silent) setRefreshing(false)
      else setLoading(false)
    }
  }, [db])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const refreshHandler = () => void load(true)
    window.addEventListener('althea-refresh', refreshHandler)
    return () => window.removeEventListener('althea-refresh', refreshHandler)
  }, [load])

  useEffect(() => {
    let refreshTimer: number | undefined
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false

    const subscribe = async () => {
      const { data: auth } = await db.auth.getUser()
      if (cancelled || !auth.user) return

      const sync = () => {
        window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => void load(true), 300)
      }

      channel = db
        .channel(`althea-dashboard-sales-${auth.user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'sales', filter: `user_id=eq.${auth.user.id}` },
          sync,
        )
        .subscribe()
    }

    void subscribe()

    return () => {
      cancelled = true
      window.clearTimeout(refreshTimer)
      if (channel) void db.removeChannel(channel)
    }
  }, [db, load])

  const periodSales = useMemo(
    () => sales.filter((sale) => {
      const date = dateOf(sale)
      return date >= range.start && date <= range.end
    }),
    [range, sales],
  )

  const previousRange = useMemo<Range>(() => ({
    start: addDays(range.start, -rangeDays),
    end: addDays(range.start, -1),
  }), [range, rangeDays])

  const previousSales = useMemo(
    () => sales.filter((sale) => {
      const date = dateOf(sale)
      return date >= previousRange.start && date <= previousRange.end
    }),
    [previousRange, sales],
  )

  const approvedSales = useMemo(() => periodSales.filter(isApproved), [periodSales])
  const pendingSales = useMemo(() => periodSales.filter(isPending), [periodSales])
  const revenue = useMemo(() => approvedSales.reduce((total, sale) => total + amountOf(sale), 0), [approvedSales])
  const ticket = approvedSales.length > 0 ? revenue / approvedSales.length : 0
  const approvalRate = periodSales.length > 0 ? (approvedSales.length / periodSales.length) * 100 : 0

  const previousRevenue = useMemo(
    () => previousSales.filter(isApproved).reduce((total, sale) => total + amountOf(sale), 0),
    [previousSales],
  )

  const revenueChange = previousRevenue === 0
    ? revenue > 0 ? 100 : 0
    : ((revenue - previousRevenue) / previousRevenue) * 100

  const customers = useMemo(() => {
    const ids = new Set<string>()
    for (const sale of periodSales) {
      const data = sale.data ?? {}
      const customer = data.customer
      const customerRecord = customer && typeof customer === 'object'
        ? customer as Record<string, unknown>
        : null
      const identifier = String(
        sale.customer_id
        ?? data.customer_id
        ?? customerRecord?.id
        ?? customerRecord?.email
        ?? data.customer_email
        ?? '',
      ).trim()
      if (identifier) ids.add(identifier)
    }
    return ids.size
  }, [periodSales])

  const daily = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of approvedSales) {
      const date = dateOf(sale)
      if (!date) continue
      map.set(date, (map.get(date) ?? 0) + amountOf(sale))
    }

    const output: Array<{ date: string; value: number }> = []
    for (let cursor = range.start; cursor <= range.end; cursor = addDays(cursor, 1)) {
      output.push({ date: cursor, value: map.get(cursor) ?? 0 })
    }
    return output
  }, [approvedSales, range])

  const maxDaily = Math.max(1, ...daily.map((item) => item.value))
  const chartPoints = daily.map((item, index) => {
    const x = daily.length === 1 ? 150 : 7 + (index * 286) / (daily.length - 1)
    const y = 104 - (item.value / maxDaily) * 78
    return `${x},${y}`
  }).join(' ')

  const latestSales = useMemo(() => periodSales.slice(0, 5), [periodSales])

  const updatedLabel = lastUpdated
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(lastUpdated)
    : 'Sincronizando…'

  const trendLabel = `${revenueChange >= 0 ? '↑' : '↓'} ${Math.abs(revenueChange).toFixed(1).replace('.', ',')}%`

  const emptyState = (
    <div className="flex min-h-[190px] flex-col items-center justify-center rounded-[18px] border border-dashed border-white/[0.10] bg-[#0b0c0d] px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#1DB854]/15 bg-[#0e1512] text-[#1DB854]">
        <Wallet size={22} strokeWidth={1.7} />
      </div>
      <p className="mt-4 text-sm font-semibold text-zinc-100">Nenhuma venda ainda</p>
      <p className="mt-1 max-w-[260px] text-[11px] leading-5 text-[#737d79]">As vendas realizadas aparecerão aqui automaticamente.</p>
    </div>
  )

  return (
    <section className="min-h-full bg-[#0B0B0D] px-4 pb-8 pt-5 text-white antialiased">
      <div className="mx-auto w-full max-w-xl space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-[#1DB854]">ALTHEA PAY</p>
            <h1 className="mt-1 text-[25px] font-bold tracking-[-0.035em] text-zinc-100">Olá, {{}} 👋</h1>
            <p className="mt-1 text-xs text-[#9aa39f]">Aqui está o resumo geral da sua operação.</p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1DB854] shadow-[0_0_8px_rgba(29,184,84,.75)]" />
              <span className="text-[9px] font-mono text-[#1DB854]">Última atualização: {updatedLabel}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading || refreshing}
              aria-label="Atualizar dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.025] text-[#9aa39f] transition-all duration-200 hover:border-[#1DB854]/35 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => setShowValues((value) => !value)}
              aria-label={showValues ? 'Ocultar valores' : 'Mostrar valores'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.025] text-[#9aa39f] transition-all duration-200 hover:border-[#1DB854]/35 hover:text-white active:scale-95"
            >
              {showValues ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
          </div>
        </header>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Período">
          {RANGE_OPTIONS.map((option) => {
            const active = option.value === rangeDays
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRangeDays(option.value)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-semibold tracking-[0.08em] transition-all duration-200 ${
                  active
                    ? 'border-[#1DB854]/45 bg-[#1DB854]/10 text-[#1DB854]'
                    : 'border-white/[0.08] bg-white/[0.02] text-[#858e8a] hover:border-white/15 hover:text-zinc-100'
                }`}
              >
                {option.label}
              </button>
            )
          })}
          <span className="ml-auto shrink-0 whitespace-nowrap text-[9px] text-[#68736e]">{formatDate(range.start)} — {formatDate(range.end)}</span>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4" role="alert">
            <p className="text-xs font-semibold text-red-200">Sincronização indisponível</p>
            <p className="mt-1 text-[11px] text-red-200/60">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-lg border border-red-300/20 px-3 py-2 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/10"
            >
              Tentar novamente
            </button>
          </div>
        )}

        <article className="relative h-[205px] overflow-hidden rounded-[19px] border border-[#1DB854]/30 bg-[#0b0d0c] p-5 shadow-[0_18px_60px_rgba(0,0,0,.28)]">
          <div className="pointer-events-none absolute inset-0 opacity-80">
            <svg viewBox="0 0 300 205" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
              <defs>
                <linearGradient id="altheaRevenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1DB854" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#1DB854" stopOpacity="0" />
                </linearGradient>
                <filter id="altheaGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <path d="M0 180 C45 171 67 174 102 145 S164 125 190 108 S241 46 300 28 L300 205 L0 205 Z" fill="url(#altheaRevenueFill)" />
              <path d="M0 180 C45 171 67 174 102 145 S164 125 190 108 S241 46 300 28" fill="none" stroke="#1DB854" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
              <circle cx="300" cy="28" r="3.6" fill="#25e66b" filter="url(#altheaGlow)" />
            </svg>
          </div>

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#7f8985]">Faturamento</span>
              <div className="mt-3 text-[37px] font-semibold leading-none tracking-[-0.055em] text-white">
                {loading ? <span className="inline-block h-9 w-36 animate-pulse rounded-md bg-white/[0.07]" /> : showValues ? formatMoney(revenue) : '••••••'}
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-white/[0.07] pt-3 text-[10px]">
              <span className={`font-semibold ${revenueChange >= 0 ? 'text-[#1DB854]' : 'text-red-300'}`}>{loading ? '—' : trendLabel}</span>
              <span className="text-[#7d8582]">em relação ao período anterior</span>
            </div>
          </div>
        </article>

        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Vendas" value={String(periodSales.length)} detail="Transações no período" icon={ShoppingCart} loading={loading} masked={!showValues} />
          <MetricCard label="Aprovadas" value={String(approvedSales.length)} detail={`${approvalRate.toFixed(1).replace('.', ',')}% de aprovação`} icon={CheckCircle2} loading={loading} masked={!showValues} accent />
          <MetricCard label="Ticket médio" value={formatMoney(ticket)} detail="Por venda aprovada" icon={Ticket} loading={loading} masked={!showValues} />
          <MetricCard label="Pendentes" value={String(pendingSales.length)} detail="Aguardando processamento" icon={Clock3} loading={loading} masked={!showValues} />
        </div>

        <article className="rounded-[19px] border border-white/[0.07] bg-[#0c0d0e] p-4 shadow-[0_14px_50px_rgba(0,0,0,.16)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7d8984]">Desempenho</span>
              <strong className="mt-1 block text-base font-semibold tracking-tight text-white">Receita ao longo do tempo</strong>
            </div>
            <BarChart3 size={17} className="mt-0.5 text-[#1DB854]" />
          </div>

          {daily.some((item) => item.value > 0) ? (
            <>
              <div className="relative mt-5 h-32 overflow-hidden rounded-xl bg-white/[0.012]">
                <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Gráfico de receita">
                  <path d="M7 20H293 M7 50H293 M7 80H293 M7 110H293" stroke="currentColor" strokeOpacity=".055" fill="none" />
                  <polyline points={chartPoints} fill="none" stroke="#1DB854" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="mt-2 flex justify-between text-[9px] text-[#68736e]">
                <span>{formatDate(range.start)}</span>
                <span>{formatDate(range.end)}</span>
              </div>
            </>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <BarChart3 size={21} className="text-[#303936]" />
              <p className="mt-2 text-[11px] text-[#737d79]">{loading ? 'Sincronizando dados…' : 'Sem receita aprovada no período selecionado.'}</p>
            </div>
          )}
        </article>

        <article className="rounded-[19px] border border-white/[0.07] bg-[#0c0d0e] p-4 shadow-[0_14px_50px_rgba(0,0,0,.16)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7d8984]">Movimentação</span>
              <h2 className="mt-1 text-base font-semibold tracking-tight text-white">Vendas recentes</h2>
            </div>
            <span className="rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[9px] text-[#737d79]">{periodSales.length} no período</span>
          </div>

          <div className="mt-5">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="flex items-center gap-3" aria-hidden="true">
                    <div className="h-9 w-9 animate-pulse rounded-full bg-white/[0.05]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-28 animate-pulse rounded bg-white/[0.05]" />
                      <div className="h-2 w-20 animate-pulse rounded bg-white/[0.04]" />
                    </div>
                    <div className="h-3 w-16 animate-pulse rounded bg-white/[0.05]" />
                  </div>
                ))}
              </div>
            ) : latestSales.length > 0 ? (
              latestSales.map((sale) => <RecentSale key={sale.id} sale={sale} masked={!showValues} />)
            ) : (
              emptyState
            )}
          </div>
        </article>

        <div className="grid grid-cols-3 gap-2 pb-2">
          {[
            { icon: CreditCard, label: 'Gateway', value: 'Conectado' },
            { icon: UserRound, label: 'Clientes', value: String(customers) },
            { icon: TrendingUp, label: 'Conversão', value: `${approvalRate.toFixed(1).replace('.', ',')}%` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-2xl border border-white/[0.06] bg-white/[0.018] px-3 py-3">
              <Icon size={14} className="text-[#1DB854]" />
              <p className="mt-2 text-[9px] uppercase tracking-[0.12em] text-[#68736e]">{label}</p>
              <p className="mt-1 truncate text-[11px] font-semibold text-zinc-200">{showValues ? value : '••••'}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-2 pb-2 text-[9px] text-[#4f5a55]">
          <Filter size={11} />
          <span>Dados sincronizados diretamente com a operação</span>
        </div>
      </div>
    </section>
  )
}
