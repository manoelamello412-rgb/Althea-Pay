'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  CreditCard,
  RefreshCw,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type FilterItem = { id: string; name: string; provider?: string | null }
type DailyRow = {
  day: string
  transactions: number
  approved: number
  failed: number
  revenue: number
  checkouts: number
  checkout_completed: number
  checkout_abandoned: number
}
type FunnelRow = {
  funnel_id: string
  funnel_name: string
  transactions: number
  approved: number
  failed: number
  revenue: number
  approval_rate: number
  checkouts: number
  checkout_completed: number
  checkout_abandoned: number
  checkout_conversion: number
}
type GatewayRow = {
  gateway_id: string
  gateway_name: string
  provider: string | null
  transactions: number
  approved: number
  failed: number
  revenue: number
  approval_rate: number
  average_duration_ms: number
}
type StatusRow = { status: string; count: number; volume: number }
type Metrics = {
  transactions: number
  approved_count: number
  pending_count: number
  failed_count: number
  refunded_count: number
  chargeback_count: number
  gross_volume: number
  approved_volume: number
  average_ticket: number
  approval_rate: number
  checkout_count: number
  checkout_completed: number
  checkout_abandoned: number
  checkout_conversion: number
  recovery_active: number
  recovery_touched: number
}
type AnalyticsPayload = {
  period: Json
  filters: {
    funnel_id: string | null
    gateway_id: string | null
    funnels: FilterItem[]
    gateways: FilterItem[]
  }
  metrics: Metrics
  previous: Partial<Metrics>
  daily: DailyRow[]
  funnels: FunnelRow[]
  gateways: GatewayRow[]
  status_distribution: StatusRow[]
}

const EMPTY_METRICS: Metrics = {
  transactions: 0,
  approved_count: 0,
  pending_count: 0,
  failed_count: 0,
  refunded_count: 0,
  chargeback_count: 0,
  gross_volume: 0,
  approved_volume: 0,
  average_ticket: 0,
  approval_rate: 0,
  checkout_count: 0,
  checkout_completed: 0,
  checkout_abandoned: 0,
  checkout_conversion: 0,
  recovery_active: 0,
  recovery_touched: 0,
}

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const money = (value: unknown, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(num(value))

const pct = (value: unknown) => `${num(value).toFixed(1).replace('.', ',')}%`

const shortDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value))

function delta(current: unknown, previous: unknown) {
  const now = num(current)
  const before = num(previous)
  if (before === 0) return now === 0 ? 0 : null
  return ((now - before) / Math.abs(before)) * 100
}

function statusLabel(status: string) {
  return ({
    approved: 'Aprovadas',
    pending: 'Pendentes',
    processing: 'Processando',
    created: 'Criadas',
    failed: 'Falhas',
    refunded: 'Reembolsadas',
    chargeback: 'Chargebacks',
  } as Record<string, string>)[status] || status
}

export default function AnalyticsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30 | 90>(30)
  const [funnelId, setFunnelId] = useState('all')
  const [gatewayId, setGatewayId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError(null)

    try {
      const result = await db.rpc('revenue_analytics_v1', {
        p_days: period,
        p_funnel_id: funnelId === 'all' ? null : funnelId,
        p_gateway_id: gatewayId === 'all' ? null : gatewayId,
      })
      if (result.error) throw result.error

      const data = obj(result.data)
      const filters = obj(data.filters)
      setPayload({
        period: obj(data.period),
        filters: {
          funnel_id: typeof filters.funnel_id === 'string' ? filters.funnel_id : null,
          gateway_id: typeof filters.gateway_id === 'string' ? filters.gateway_id : null,
          funnels: Array.isArray(filters.funnels) ? filters.funnels as FilterItem[] : [],
          gateways: Array.isArray(filters.gateways) ? filters.gateways as FilterItem[] : [],
        },
        metrics: { ...EMPTY_METRICS, ...obj(data.metrics) } as Metrics,
        previous: obj(data.previous) as Partial<Metrics>,
        daily: Array.isArray(data.daily) ? data.daily as DailyRow[] : [],
        funnels: Array.isArray(data.funnels) ? data.funnels as FunnelRow[] : [],
        gateways: Array.isArray(data.gateways) ? data.gateways as GatewayRow[] : [],
        status_distribution: Array.isArray(data.status_distribution) ? data.status_distribution as StatusRow[] : [],
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as métricas reais.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db, funnelId, gatewayId, period])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    let active = true
    void db.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      const profile = await db.from('profiles')
        .select('default_organization_id')
        .eq('id', data.user.id)
        .single()
      if (active && !profile.error && profile.data?.default_organization_id) {
        setOrganizationId(String(profile.data.default_organization_id))
      }
    })
    return () => { active = false }
  }, [db])

  useEffect(() => {
    if (!organizationId) return
    let timer: number | null = null
    const refresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load(false)
      }, 700)
    }
    const channel = db.channel(`analytics-org-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe()

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId])

  const metrics = payload?.metrics ?? EMPTY_METRICS
  const previous = payload?.previous ?? {}
  const daily = payload?.daily ?? []
  const maxRevenue = Math.max(1, ...daily.map(row => num(row.revenue)))
  const statusMax = Math.max(1, ...(payload?.status_distribution ?? []).map(row => num(row.count)))

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Inteligência operacional</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Analytics</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Métricas consolidadas no servidor por organização. O navegador recebe apenas agregados, séries e rankings — não milhares de transações.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={funnelId} onChange={event => setFunnelId(event.target.value)} className="h-10 min-w-[190px] rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os funis</option>
            {(payload?.filters.funnels ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={gatewayId} onChange={event => setGatewayId(event.target.value)} className="h-10 min-w-[190px] rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os gateways</option>
            {(payload?.filters.gateways ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <div className="flex rounded-xl border border-white/[.06] bg-[var(--althea-surface)] p-1">
            {([7, 30, 90] as const).map(days => (
              <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${period === days ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
                {days} dias
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(false)} disabled={refreshing} aria-label="Atualizar" className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-400/15 bg-red-400/[.05] p-4 text-xs text-red-200">
          <X size={15} className="text-red-300" /> {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Receita aprovada" value={loading ? '—' : money(metrics.approved_volume)} change={delta(metrics.approved_volume, previous.approved_volume)} note="vs. período anterior" />
        <Metric label="Taxa de aprovação" value={loading ? '—' : pct(metrics.approval_rate)} change={delta(metrics.approval_rate, previous.approval_rate)} note={`${metrics.approved_count} de ${metrics.transactions} transações`} />
        <Metric label="Conversão checkout" value={loading ? '—' : pct(metrics.checkout_conversion)} change={delta(metrics.checkout_conversion, previous.checkout_conversion)} note={`${metrics.checkout_completed} de ${metrics.checkout_count} sessões`} />
        <Metric label="Ticket médio" value={loading ? '—' : money(metrics.average_ticket)} change={delta(metrics.average_ticket, previous.average_ticket)} note="transações aprovadas" />
        <Metric label="Pendentes" value={loading ? '—' : String(metrics.pending_count)} note="created + pending + processing" />
        <Metric label="Falhas" value={loading ? '—' : String(metrics.failed_count)} change={delta(metrics.failed_count, previous.failed_count)} note="transações falhadas" warning={metrics.failed_count > 0} />
        <Metric label="Abandonos" value={loading ? '—' : String(metrics.checkout_abandoned)} change={delta(metrics.checkout_abandoned, previous.checkout_abandoned)} note="checkouts abandonados" warning={metrics.checkout_abandoned > 0} />
        <Metric label="Recuperação ativa" value={loading ? '—' : String(metrics.recovery_active)} note={`${metrics.recovery_touched} checkouts já tocados`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Receita e atividade diária</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Série consolidada diretamente no banco.</p></div>
            <BarChart3 size={17} className="text-[var(--althea-brand)]" />
          </div>
          {loading ? <Skeleton height="h-64" /> : daily.length === 0 ? <Empty /> : (
            <div className="mt-6 overflow-x-auto">
              <div className="flex min-w-[680px] items-end gap-1.5 border-b border-white/[.05] pb-2" style={{ height: 260 }}>
                {daily.map(row => {
                  const height = Math.max(3, num(row.revenue) / maxRevenue * 210)
                  return (
                    <div key={row.day} className="group flex min-w-0 flex-1 flex-col items-center justify-end">
                      <div className="pointer-events-none mb-2 hidden w-max max-w-40 rounded-lg border border-white/[.07] bg-[#0b100d] px-2 py-1.5 text-center text-[8px] text-zinc-300 shadow-xl group-hover:block">
                        <b className="block text-white">{money(row.revenue)}</b>
                        {row.approved} aprovadas · {row.failed} falhas
                      </div>
                      <div className="w-full max-w-5 rounded-t bg-[var(--althea-brand)]/75 transition group-hover:brightness-125" style={{ height }} />
                      <span className="mt-2 rotate-[-45deg] whitespace-nowrap text-[7px] text-[var(--althea-muted)]">{shortDate(row.day)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Estados financeiros</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Distribuição das transações no período.</p></div>
            <Activity size={17} className="text-[var(--althea-brand)]" />
          </div>
          <div className="mt-5 space-y-3">
            {(payload?.status_distribution ?? []).length === 0 ? <Empty /> : (payload?.status_distribution ?? []).map(row => (
              <div key={row.status}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[9px]"><span className="text-[var(--althea-muted)]">{statusLabel(row.status)}</span><b className="text-zinc-300">{row.count}</b></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[.04]"><div className="h-full rounded-full bg-[var(--althea-brand)]/70" style={{ width: `${Math.max(2, num(row.count) / statusMax * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Mini icon={RotateCcw} label="Reembolsos" value={metrics.refunded_count} />
            <Mini icon={AlertTriangle} label="Chargebacks" value={metrics.chargeback_count} danger={metrics.chargeback_count > 0} />
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <PerformanceTable
          title="Desempenho por funil"
          icon={TrendingUp}
          rows={(payload?.funnels ?? []).slice(0, 12).map(row => ({
            id: row.funnel_id,
            name: row.funnel_name,
            revenue: row.revenue,
            approval: row.approval_rate,
            conversion: row.checkout_conversion,
            total: row.transactions,
            failures: row.failed,
          }))}
          secondaryLabel="Conversão"
        />
        <GatewayTable rows={(payload?.gateways ?? []).slice(0, 12)} />
      </section>
    </div>
  )
}

function Metric({ label, value, note, change, warning = false }: { label: string; value: string; note: string; change?: number | null; warning?: boolean }) {
  return (
    <article className="min-h-[132px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
      <strong className={`mt-4 block text-[24px] font-semibold tracking-[-.035em] ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}</strong>
      <div className="mt-2 flex items-center gap-2">
        {change !== undefined && change !== null && <Change value={change} />}
        {change === null && <span className="text-[8px] text-[var(--althea-brand)]">novo</span>}
        <small className="text-[8px] text-[#617068]">{note}</small>
      </div>
    </article>
  )
}

function Change({ value }: { value: number }) {
  const up = value > 0
  const flat = Math.abs(value) < 0.05
  return <span className={`inline-flex items-center gap-0.5 text-[8px] ${flat ? 'text-[var(--althea-muted)]' : up ? 'text-[var(--althea-brand)]' : 'text-red-300'}`}>
    {flat ? null : up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
    {value > 0 ? '+' : ''}{value.toFixed(1).replace('.', ',')}%
  </span>
}

function Mini({ icon: Icon, label, value, danger = false }: { icon: typeof CreditCard; label: string; value: number; danger?: boolean }) {
  return <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3"><Icon size={13} className={danger ? 'text-red-300' : 'text-[var(--althea-brand)]'} /><span className="mt-2 block text-[8px] text-[var(--althea-muted)]">{label}</span><b className="mt-1 block text-sm text-white">{value}</b></div>
}

function PerformanceTable({ title, icon: Icon, rows, secondaryLabel }: {
  title: string
  icon: typeof TrendingUp
  secondaryLabel: string
  rows: Array<{ id: string; name: string; revenue: number; approval: number; conversion: number; total: number; failures: number }>
}) {
  return <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
    <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Receita, aprovação e eficiência operacional.</p></div><Icon size={17} className="text-[var(--althea-brand)]" /></div>
    <div className="mt-5 overflow-x-auto">
      {rows.length === 0 ? <Empty /> : <table className="w-full min-w-[560px] text-left">
        <thead><tr className="border-b border-white/[.05] text-[8px] uppercase tracking-wider text-[var(--althea-muted)]"><th className="pb-2.5">Funil</th><th className="pb-2.5">Receita</th><th className="pb-2.5">Aprovação</th><th className="pb-2.5">{secondaryLabel}</th><th className="pb-2.5">Falhas</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-b border-white/[.035] last:border-0"><td className="py-3 pr-3"><b className="block max-w-[190px] truncate text-[10px] text-zinc-200">{row.name}</b><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{row.total} transações</span></td><td className="py-3 pr-3 text-[10px] font-semibold text-white">{money(row.revenue)}</td><td className="py-3 pr-3 text-[10px] text-zinc-300">{pct(row.approval)}</td><td className="py-3 pr-3 text-[10px] text-zinc-300">{pct(row.conversion)}</td><td className="py-3 text-[10px] text-zinc-300">{row.failures}</td></tr>)}</tbody>
      </table>}
    </div>
  </article>
}

function GatewayTable({ rows }: { rows: GatewayRow[] }) {
  return <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
    <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">Desempenho por gateway</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Receita, aprovação, falhas e latência observada.</p></div><CreditCard size={17} className="text-[var(--althea-brand)]" /></div>
    <div className="mt-5 overflow-x-auto">
      {rows.length === 0 ? <Empty /> : <table className="w-full min-w-[560px] text-left">
        <thead><tr className="border-b border-white/[.05] text-[8px] uppercase tracking-wider text-[var(--althea-muted)]"><th className="pb-2.5">Gateway</th><th className="pb-2.5">Receita</th><th className="pb-2.5">Aprovação</th><th className="pb-2.5">Falhas</th><th className="pb-2.5">Latência</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.gateway_id} className="border-b border-white/[.035] last:border-0"><td className="py-3 pr-3"><b className="block max-w-[190px] truncate text-[10px] text-zinc-200">{row.gateway_name}</b><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{row.provider || 'provider não informado'} · {row.transactions} transações</span></td><td className="py-3 pr-3 text-[10px] font-semibold text-white">{money(row.revenue)}</td><td className="py-3 pr-3 text-[10px] text-zinc-300">{pct(row.approval_rate)}</td><td className="py-3 pr-3 text-[10px] text-zinc-300">{row.failed}</td><td className="py-3 text-[10px] text-zinc-300">{num(row.average_duration_ms).toFixed(0)} ms</td></tr>)}</tbody>
      </table>}
    </div>
  </article>
}

function Skeleton({ height }: { height: string }) {
  return <div className={`mt-5 animate-pulse rounded-xl bg-[var(--althea-bg)] ${height}`} />
}

function Empty() {
  return <div className="mt-4 grid min-h-[150px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] text-center"><div><CheckCircle2 size={20} className="mx-auto text-[var(--althea-brand)] opacity-60" /><p className="mt-2 text-[10px] text-[var(--althea-muted)]">Sem dados no período selecionado.</p></div></div>
}
