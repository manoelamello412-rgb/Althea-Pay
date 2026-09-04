'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, CreditCard, Network, RefreshCw, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react'
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

type Range = { start: string; end: string }

const TZ = 'America/Sao_Paulo'
const APPROVED = new Set(['approved', 'completed', 'paid', 'success', 'succeeded'])

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
const isApproved = (value: unknown) => APPROVED.has(String(value ?? '').toLowerCase())

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  loading,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Wallet
  loading: boolean
}) {
  return (
    <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4 shadow-[0_12px_40px_rgba(0,0,0,.14)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#71817A]">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1D8B54]/10 text-[#1D8B54]">
          <Icon size={15} />
        </span>
      </div>
      {loading ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded-md bg-white/[0.06]" />
      ) : (
        <strong className="mt-3 block truncate text-xl font-bold tracking-tight text-white">{value}</strong>
      )}
      <span className="mt-1 block truncate text-[10px] text-slate-500">{detail}</span>
    </article>
  )
}

export default function DashboardMobileModern() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [range, setRange] = useState<Range>(() => {
    const current = today()
    return { start: current, end: current }
  })
  const [sales, setSales] = useState<Sale[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) {
        setSales([])
        setGateways([])
        return
      }

      const current = today()
      const since = addDays(current, -89)

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
      setLoading(false)
    }
  }, [db])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const sync = () => void load()
    const channel = db
      .channel('althea-dashboard-mobile-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, sync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateways' }, sync)
      .subscribe()

    return () => {
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

  const approvedSales = useMemo(
    () => periodSales.filter((sale) => isApproved(sale.status)),
    [periodSales],
  )

  const revenue = useMemo(
    () => approvedSales.reduce((total, sale) => total + amountOf(sale), 0),
    [approvedSales],
  )

  const ticket = approvedSales.length ? revenue / approvedSales.length : 0

  const customers = useMemo(() => {
    return new Set(
      periodSales
        .map((sale) => {
          const data = sale.data ?? {}
          return String(data.customer_id ?? (data.customer as Record<string, unknown> | undefined)?.id ?? (data.customer as Record<string, unknown> | undefined)?.email ?? '')
        })
        .filter(Boolean),
    ).size
  }, [periodSales])

  const daily = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of approvedSales) {
      const date = dateOf(sale)
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

  const selectPreset = (days: number) => {
    const current = today()
    setRange({ start: addDays(current, -(days - 1)), end: current })
  }

  return (
    <section className="min-h-full bg-[#0B0B0D] px-4 pb-8 pt-5 text-slate-100">
      <div className="mx-auto w-full max-w-xl space-y-5">
        <header className="flex items-center justify-between">
          <div>
            <span className="text-[9px] font-semibold uppercase tracking-[.2em] text-[#1D8B54]">ALTHEA PAY</span>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Dashboard</h1>
            <p className="mt-1 text-xs text-slate-500">Visão operacional em tempo real</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Atualizar dashboard"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-slate-300 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            ['Hoje', 1],
            ['7 dias', 7],
            ['30 dias', 30],
            ['90 dias', 90],
          ].map(([label, days]) => {
            const current = today()
            const selected = range.end === current && range.start === addDays(current, -(Number(days) - 1))
            return (
              <button
                key={String(days)}
                type="button"
                onClick={() => selectPreset(Number(days))}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-medium transition ${selected ? 'border-[#1D8B54]/40 bg-[#1D8B54]/10 text-[#4DDA8A]' : 'border-white/[0.07] bg-white/[0.025] text-slate-400'}`}
              >
                <CalendarDays size={13} />
                {label}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4">
            <p className="text-xs font-semibold text-red-300">Sincronização indisponível</p>
            <p className="mt-1 text-[11px] text-red-200/60">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-red-400/20 px-3 py-2 text-[11px] font-semibold text-red-200">Tentar novamente</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Receita" value={money(revenue)} detail="Vendas aprovadas" icon={Wallet} loading={loading} />
          <MetricCard label="Transações" value={String(periodSales.length)} detail="No período" icon={CreditCard} loading={loading} />
          <MetricCard label="Ticket médio" value={money(ticket)} detail="Por venda aprovada" icon={TrendingUp} loading={loading} />
          <MetricCard label="Clientes" value={String(customers)} detail="Identificados nas vendas" icon={Users} loading={loading} />
        </div>

        <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Receita ao longo do tempo</span>
              <strong className="mt-1 block text-lg font-bold text-white">{loading ? '—' : money(revenue)}</strong>
            </div>
            <BarChart3 size={17} className="text-[#1D8B54]" />
          </div>

          {daily.some((item) => item.value > 0) ? (
            <>
              <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="mt-5 h-32 w-full" role="img" aria-label="Gráfico de receita">
                <path d="M8 25H292 M8 55H292 M8 85H292 M8 115H292" stroke="currentColor" strokeOpacity=".06" fill="none" />
                <polyline points={chartPoints} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#1D8B54]" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="flex justify-between text-[9px] text-slate-600">
                <span>{shortDate(range.start)}</span>
                <span>{shortDate(range.end)}</span>
              </div>
            </>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <BarChart3 size={22} className="text-slate-700" />
              <p className="mt-2 text-[11px] text-slate-500">{loading ? 'Sincronizando dados…' : 'Sem receita aprovada no período.'}</p>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Transações recentes</span>
              <p className="mt-1 text-[10px] text-slate-600">Últimas operações do período</p>
            </div>
            <ShoppingBag size={17} className="text-slate-600" />
          </div>

          {periodSales.length ? (
            <div className="mt-3 divide-y divide-white/[0.05]">
              {periodSales.slice(0, 5).map((sale) => {
                const data = sale.data ?? {}
                const customer = String((data.customer as Record<string, unknown> | undefined)?.name ?? (data.customer as Record<string, unknown> | undefined)?.email ?? 'Cliente')
                return (
                  <div key={sale.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">{customer}</p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-600">{dateOf(sale) ? shortDate(dateOf(sale)) : 'Data indisponível'} · {sale.gateway_id || 'Gateway'}</p>
                    </div>
                    <strong className="shrink-0 text-xs text-white">{money(amountOf(sale))}</strong>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-9 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.03] text-slate-700"><CreditCard size={20} /></span>
              <strong className="mt-3 text-xs text-white">Nenhuma transação encontrada</strong>
              <p className="mt-1 max-w-[260px] text-[10px] leading-4 text-slate-600">As operações reais aparecerão aqui assim que existirem no período selecionado.</p>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[0.07] bg-[#101713] p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-500">Gateways</span>
              <p className="mt-1 text-[10px] text-slate-600">Infraestrutura conectada</p>
            </div>
            <Network size={17} className="text-[#1D8B54]" />
          </div>

          {gateways.length ? (
            <div className="mt-3 space-y-2">
              {gateways.slice(0, 5).map((gateway) => {
                const data = gateway.data ?? {}
                const name = String(data.name ?? data.provider ?? gateway.id)
                return (
                  <div key={gateway.id} className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3">
                    <span className="truncate text-xs font-medium text-white">{name}</span>
                    <span className="ml-3 inline-flex items-center gap-1.5 text-[10px] text-[#4DDA8A]"><i className="h-1.5 w-1.5 rounded-full bg-[#1D8B54]" /> Conectado</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/[0.07] px-4 py-5 text-center">
              <p className="text-[11px] text-slate-500">Nenhum gateway conectado.</p>
              <p className="mt-1 text-[10px] text-slate-700">Configure sua infraestrutura de pagamentos para começar.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
