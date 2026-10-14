'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, RefreshCw, TrendingUp, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { parseOrganizationAccess } from '@/lib/auth/organization-access'

type Option = { id: string; name: string | null }
type BreakdownRow = { funnel_id?: string | null; product_id?: string | null; gateway_id?: string | null; name: string | null; total: number; approved: number; gross: number | null; currency: string | null; currency_count: number }
type Summary = {
  can_view_values: boolean
  transactions: number
  by_status: Record<string, number>
  revenue: { currency: string; amount: number; approved: number }[] | null
  checkouts: { started: number; completed: number }
  by_funnel: BreakdownRow[]
  by_product: BreakdownRow[]
  by_gateway: BreakdownRow[]
  leads: { new_customers: number }
  filters: { funnels: Option[]; products: Option[]; gateways: Option[] }
}
type Filters = { funnel: string; product: string; gateway: string; status: string }

const STATUSES = [['approved', 'Aprovadas'], ['pending', 'Pendentes'], ['failed', 'Falhas']] as const
const money = (value: number, currency = 'BRL') => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const pct = (value: number) => `${value.toFixed(1)}%`

function Breakdown({ title, empty, rows, hidden }: { title: string; empty: string; rows: BreakdownRow[] | undefined; hidden: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-black">{title}</h2><p className="text-xs text-slate-600">Receita e aprovação no período selecionado.</p></div><BarChart3 size={19} className="text-slate-600" /></div>
    {!rows?.length ? <div className="flex min-h-48 flex-col items-center justify-center text-center"><Activity size={24} className="mb-2 text-slate-700" /><b>Nenhum dado no período</b><p className="mt-1 text-xs text-slate-600">As métricas serão preenchidas quando eventos reais chegarem.</p></div>
      : <div className="space-y-3">{rows.map(row => { const id = row.funnel_id ?? row.product_id ?? row.gateway_id; return <div key={id ?? 'none'} className="rounded-xl border border-white/[.06] p-4"><div className="flex items-center justify-between gap-3"><span className="truncate text-xs text-slate-400">{row.name || id || empty}</span><strong className="text-sm">{hidden ? '—' : row.currency_count > 1 ? `${row.currency_count} moedas` : money(row.gross ?? 0, row.currency || 'BRL')}</strong></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${row.total ? Math.min(100, row.approved / row.total * 100) : 0}%` }} /></div><div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-slate-600"><span>{row.approved}/{row.total} aprovadas</span><span>{row.total ? pct(row.approved / row.total * 100) : '0.0%'}</span></div></div> })}</div>}
  </div>
}

export default function AnalyticsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [organizationId, setOrganizationId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30 | 90>(30)
  const [filters, setFilters] = useState<Filters>({ funnel: '', product: '', gateway: '', status: '' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const access = parseOrganizationAccess(accessResult.data)
      setOrganizationId(access?.organization_id ?? '')
      if (!access) { setSummary(null); return }
      const result = await db.rpc('analytics_summary_v1', { p_days: period, p_funnel_id: filters.funnel || null, p_product_id: filters.product || null, p_gateway_id: filters.gateway || null, p_status: filters.status || null })
      if (result.error) throw result.error
      setSummary(result.data as Summary)
    } catch (cause) {
      console.error('[ALTHEA-ANALYTICS]', cause)
      setError('Não foi possível carregar as métricas reais.')
    } finally { setLoading(false) }
  }, [db, period, filters])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!organizationId) return
    // ponytail: reloads the whole summary on every change; debounce if a busy org floods realtime
    const channel = db.channel(`analytics-${organizationId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `organization_id=eq.${organizationId}` }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions', filter: `organization_id=eq.${organizationId}` }, () => void load()).subscribe()
    return () => { void db.removeChannel(channel) }
  }, [db, load, organizationId])

  const revenue = summary?.revenue ?? []
  const single = revenue.length === 1 ? revenue[0] : null
  const approvedCount = summary?.by_status.approved ?? 0
  const conversion = summary?.checkouts.started ? summary.checkouts.completed / summary.checkouts.started * 100 : 0
  const hidden = summary && !summary.can_view_values
  const revenueLabel = hidden ? 'Sem acesso a valores' : single ? money(single.amount, single.currency) : revenue.length ? `${revenue.length} moedas` : money(0)
  const averageLabel = hidden || revenue.length > 1 ? '—' : single && single.approved ? money(single.amount / single.approved, single.currency) : '—'
  const select = (key: keyof Filters, label: string, options: readonly (readonly [string, string])[]) => <select aria-label={label} value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })} className="h-10 max-w-48 rounded-xl border border-white/10 bg-[#0b100e] px-3 text-xs">
    <option value="">{label}: todos</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select>
  const opts = (list: Option[] | undefined) => (list ?? []).map(item => [item.id, item.name || item.id] as const)

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8"><div className="mx-auto max-w-[1700px]">
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // ANALYTICS</div><h1 className="text-3xl font-black tracking-tight">Analytics</h1><p className="mt-1 text-sm text-slate-500">Leitura operacional dos eventos reais de checkout e transações.</p></div><div className="flex gap-2"><div className="flex rounded-xl border border-white/10 bg-white/[.025] p-1">{([7,30,90] as const).map(days => <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-lg px-3 py-2 text-xs font-bold ${period === days ? 'bg-white/10 text-white' : 'text-slate-500'}`}>{days}d</button>)}</div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="rounded-xl border border-white/10 bg-white/[.03] p-2.5 text-slate-300"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button></div></header>
    <div className="mb-5 flex flex-wrap gap-2">{select('funnel', 'Funil', opts(summary?.filters.funnels))}{select('product', 'Produto', opts(summary?.filters.products))}{select('gateway', 'Gateway', opts(summary?.filters.gateways))}{select('status', 'Status', STATUSES)}</div>
    {error ? <div className="mb-5 flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm"><X size={17} className="text-red-400" />{error}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Receita aprovada</span><strong className="mt-2 block text-2xl font-black">{loading || !summary ? '—' : revenueLabel}</strong><small className="mt-2 block text-xs text-slate-600">Somente transações aprovadas</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Transações aprovadas</span><strong className="mt-2 block text-2xl font-black">{loading || !summary ? '—' : approvedCount}</strong><small className="mt-2 block text-xs text-slate-600">De {summary?.transactions ?? 0} transações</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Conversão de checkout</span><strong className="mt-2 block text-2xl font-black">{loading || !summary ? '—' : pct(conversion)}</strong><small className="mt-2 block text-xs text-slate-600">{filters.gateway ? 'Sessões concluídas / iniciadas (sem filtro de gateway)' : 'Sessões concluídas / iniciadas'}</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Ticket médio</span><strong className="mt-2 block text-2xl font-black">{loading || !summary ? '—' : averageLabel}</strong><small className="mt-2 block text-xs text-slate-600">{revenue.length > 1 ? 'Indisponível quando o período mistura moedas' : 'Por transação aprovada'}</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Novos clientes</span><strong className="mt-2 block text-2xl font-black">{loading || !summary ? '—' : summary.leads.new_customers}</strong><small className="mt-2 block text-xs text-slate-600">Leads e clientes que entraram no período</small></article></section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_.8fr]"><Breakdown title="Desempenho por funil" empty="Sem funil" rows={summary?.by_funnel} hidden={!!hidden} />
    <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-black">Estado operacional</h2><p className="text-xs text-slate-600">Distribuição das transações.</p></div><TrendingUp size={19} className="text-slate-600" /></div><div className="space-y-3"><div className="flex items-center justify-between rounded-xl border border-white/[.06] p-4"><span className="text-sm text-slate-400">Aprovadas</span><b>{summary?.by_status.approved ?? 0}</b></div><div className="flex items-center justify-between rounded-xl border border-white/[.06] p-4"><span className="text-sm text-slate-400">Pendentes</span><b>{summary?.by_status.pending ?? 0}</b></div><div className="flex items-center justify-between rounded-xl border border-white/[.06] p-4"><span className="text-sm text-slate-400">Falhas</span><b>{summary?.by_status.failed ?? 0}</b></div></div></div></section>
    <section className="mt-5 grid gap-5 xl:grid-cols-2"><Breakdown title="Desempenho por produto" empty="Sem produto" rows={summary?.by_product} hidden={!!hidden} /><Breakdown title="Desempenho por gateway" empty="Sem gateway" rows={summary?.by_gateway} hidden={!!hidden} /></section>
  </div></main>
}
