'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, CreditCard, Eye, EyeOff, Network, RefreshCw, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Sale = {
  id: string
  amount: number | string | null
  status?: string | null
  data?: Record<string, unknown> | null
  gateway_id?: string | null
  occurred_at?: string | null
  created_at?: string | null
}

type Gateway = {
  id: string
  data?: Record<string, unknown> | null
}

type RangeDays = 7 | 30 | 90

type Range = { start: string; end: string }

const TZ = 'America/Sao_Paulo'
const APPROVED = new Set(['approved', 'completed', 'paid', 'success', 'succeeded'])
const RANGE_OPTIONS: Array<{ value: RangeDays; label: string }> = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
]

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const isoDate = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const addDays = (value: string, amount: number) => {
  const date = parseDate(value)
  date.setDate(date.getDate() + amount)
  return isoDate(date)
}

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)

const shortDate = (value: string) =>
  parseDate(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })

const amountOf = (sale: Sale) => Number(sale.amount ?? sale.data?.amount ?? 0) || 0
const dateOf = (sale: Sale) => (sale.occurred_at || sale.created_at || '').slice(0, 10)
const isApproved = (value: unknown) => APPROVED.has(String(value ?? '').trim().toLowerCase())

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  loading,
  masked,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Wallet
  loading: boolean
  masked: boolean
}) {
  return (
    <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4 shadow-[0_12px_40px_rgba(0,0,0,.14)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#71817A]">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1DB854]/10 text-[#1DB854]"><Icon size={15} /></span>
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded-md bg-white/[0.06]" aria-hidden="true" />
      ) : (
        <strong className="mt-3 block truncate text-xl font-bold tracking-tight text-white">{masked ? '••••••' : value}</strong>
      )}
      <span className="mt-1 block truncate text-[10px] text-[#A6A6A6]">{detail}</span>
    </article>
  )
}

export default function DashboardMobileModern() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [sales, setSales] = useState<Sale[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showValues, setShowValues] = useState(true)

  const range = useMemo<Range>(() => {
    const end = today()
    return { start: addDays(end, -(rangeDays - 1)), end }
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
        setGateways([])
        return
      }

      const since = addDays(today(), -89)
      const [salesResult, gatewaysResult] = await Promise.all([
        db
          .from('sales')
          .select('id,amount,status,data,gateway_id,occurred_at,created_at')
          .eq('user_id', auth.user.id)
          .gte('created_at', `${since}T00:00:00-03:00`)
          .order('created_at', { ascending: false })
          .limit(5000),
        db.from('gateways').select('id,data').eq('user_id', auth.user.id).limit(100),
      ])

      if (salesResult.error) throw salesResult.error
      if (gatewaysResult.error) throw gatewaysResult.error

      setSales((salesResult.data ?? []) as Sale[])
      setGateways((gatewaysResult.data ?? []) as Gateway[])
    } catch (cause) {
      console.error('[ALTHEA-DASHBOARD-MOBILE]', cause)
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
    let timer: number | undefined
    const sync = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(true), 250)
    }

    const channel = db
      .channel('althea-dashboard-mobile-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, sync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateways' }, sync)
      .subscribe()

    return () => {
      window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load])

  const periodSales = useMemo(
    () => sales.filter((sale) => {
      const date = dateOf(sale)
      return date >= range.start && date <= range.end
    }),
    [sales, range],
  )

  const approvedSales = useMemo(() => periodSales.filter((sale) => isApproved(sale.status)), [periodSales])
  const revenue = useMemo(() => approvedSales.reduce((total, sale) => total + amountOf(sale), 0), [approvedSales])
  const ticket = approvedSales.length ? revenue / approvedSales.length : 0

  const customers = useMemo(() => {
    return new Set(
      periodSales
        .map((sale) => {
          const data = sale.data ?? {}
          const customer = data.customer
          const customerRecord = customer && typeof customer === 'object' ? customer as Record<string, unknown> : undefined
          return String(data.customer_id ?? customerRecord?.id ?? customerRecord?.email ?? '')
        })
        .filter(Boolean),
    ).size
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
  const chartPoints = daily
    .map((item, index) => {
      const x = daily.length === 1 ? 150 : 8 + (index * 284) / (daily.length - 1)
      const y = 110 - (item.value / maxDaily) * 94
      return `${x},${y}`
    })
    .join(' ')

  return (
    <section className="min-h-full bg-[#0B0B0D] px-4 pb-8 pt-5 text-slate-100">
      <div className="mx-auto w-full max-w-xl space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[9px] font-semibold uppercase tracking-[.2em] text-[#1DB854]">ALTHEA PAY</span>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Dashboard</h1>
            <p className="mt-1 text-xs text-[#A6A6A6]">Visão operacional em tempo real</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading || refreshing}
              aria-label="Atualizar dados"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-[#A6A6A6] transition-all duration-200 active:scale-95 hover:border-[#1DB854]/40 hover:text-[#1DB854] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => setShowValues((value) => !value)}
              aria-label={showValues ? 'Ocultar valores' : 'Mostrar valores'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-[#A6A6A6] transition-all duration-200 active:scale-95 hover:border-[#1DB854]/40 hover:text-[#1DB854]"
            >
              {showValues ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
          </div>
        </header>

        <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Período do dashboard">
          {RANGE_OPTIONS.map((option) => {
            const active = rangeDays === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRangeDays(option.value)}
                className={`shrink-0 rounded-full border px-4 py-2 text-[10px] font-semibold tracking-[.08em] transition-all ${active ? 'border-[#1DB854]/50 bg-[#1DB854]/10 text-[#1DB854]' : 'border-white/[0.08] bg-white/[0.025] text-[#A6A6A6] hover:border-white/20 hover:text-white'}`}
              >
                {option.label}
              </button>
            )
          })}
          <span className="ml-auto shrink-0 text-[9px] text-[#71817A]">{shortDate(range.start)} — {shortDate(range.end)}</span>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4" role="alert">
            <p className="text-xs font-semibold text-red-300">Sincronização indisponível</p>
            <p className="mt-1 text-[11px] text-red-200/60">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-red-400/20 px-3 py-2 text-[11px] font-semibold text-red-200">Tentar novamente</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Receita" value={money(revenue)} detail="Vendas aprovadas" icon={Wallet} loading={loading} masked={!showValues} />
          <MetricCard label="Transações" value={String(periodSales.length)} detail="No período selecionado" icon={CreditCard} loading={loading} masked={!showValues} />
          <MetricCard label="Ticket médio" value={money(ticket)} detail="Por venda aprovada" icon={TrendingUp} loading={loading} masked={!showValues} />
          <MetricCard label="Clientes" value={String(customers)} detail="Identificados nas vendas" icon={Users} loading={loading} masked={!showValues} />
        </div>

        <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#A6A6A6]">Receita ao longo do tempo</span>
              <strong className="mt-1 block text-lg font-bold text-white">{loading ? '—' : showValues ? money(revenue) : '••••••'}</strong>
            </div>
            <BarChart3 size={17} className="text-[#1DB854]" />
          </div>

          {daily.some((item) => item.value > 0) ? (
            <>
              <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="mt-5 h-32 w-full" role="img" aria-label="Gráfico de receita">
                <path d="M8 25H292 M8 55H292 M8 85H292 M8 115H292" stroke="currentColor" strokeOpacity=".06" fill="none" />
                <polyline points={chartPoints} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1DB854]" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="flex justify-between text-[9px] text-[#A6A6A6]"><span>{shortDate(range.start)}</span><span>{shortDate(range.end)}</span></div>
            </>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <BarChart3 size={22} className="text-slate-700" />
              <p className="mt-2 text-[11px] text-[#A6A6A6]">{loading ? 'Sincronizando dados…' : 'Sem receita aprovada no período selecionado.'}</p>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#A6A6A6]">Transações recentes</span>
              <p className="mt-1 text-[10px] text-[#A6A6A6]">Últimas operações do período selecionado</p>
            </div>
            <ShoppingBag size={17} className="text-slate-600" />
          </div>

          {periodSales.length ? (
            <div className="mt-3 divide-y divide-white/[0.05]">
              {periodSales.slice(0, 5).map((sale) => {
                const data = sale.data ?? {}
                const customerValue = data.customer
                const customer = customerValue && typeof customerValue === 'object'
                  ? String((customerValue as Record<string, unknown>).name ?? (customerValue as Record<string, unknown>).email ?? 'Cliente')
                  : String(data.customer_name ?? data.customer_email ?? 'Cliente')
                const status = String(sale.status ?? 'pendente').toLowerCase()
                return (
                  <div key={sale.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">{customer}</p>
                      <p className="mt-0.5 truncate text-[10px] text-[#A6A6A6]">{dateOf(sale) ? shortDate(dateOf(sale)) : 'Data indisponível'} · {sale.gateway_id || 'Gateway'} · {status}</p>
                    </div>
                    <strong className="shrink-0 text-xs text-white">{showValues ? money(amountOf(sale)) : '••••'}</strong>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-9 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.03] text-slate-700"><CreditCard size={20} /></span>
              <strong className="mt-3 text-xs text-white">Nenhuma transação encontrada</strong>
              <p className="mt-1 max-w-[260px] text-[10px] leading-4 text-[#A6A6A6]">As operações reais aparecerão aqui assim que existirem.</p>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#A6A6A6]">Gateways</span>
              <p className="mt-1 text-[10px] text-[#A6A6A6]">Infraestrutura conectada</p>
            </div>
            <Network size={17} className="text-[#1DB854]" />
          </div>

          {gateways.length ? (
            <div className="mt-3 space-y-2">
              {gateways.slice(0, 5).map((gateway) => {
                const data = gateway.data ?? {}
                const name = String(data.name ?? data.provider ?? gateway.id)
                return (
                  <div key={gateway.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3">
                    <span className="truncate text-xs font-medium text-white">{name}</span>
                    <span className="ml-3 inline-flex items-center gap-1.5 text-[10px] text-[#1DB854]"><i className="h-1.5 w-1.5 rounded-full bg-[#1DB854]" />Conectado</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/[0.07] px-4 py-5 text-center">
              <p className="text-[11px] text-[#A6A6A6]">Nenhum gateway conectado.</p>
              <p className="mt-1 text-[10px] text-[#A6A6A6]">Configure sua infraestrutura de pagamentos para começar.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
