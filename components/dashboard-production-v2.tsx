'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Download, Filter, Gauge, RefreshCw, Search, ShoppingCart, Wallet, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type FilterKey = 'product' | 'funnel' | 'gateway' | 'status' | 'source' | 'campaign' | 'currency' | 'payment_method'
type Json = Record<string, any>

const FILTERS: Array<[FilterKey, string]> = [
  ['product', 'Produto'], ['funnel', 'Funil'], ['gateway', 'Gateway'], ['status', 'Status'],
  ['source', 'Origem'], ['campaign', 'Campanha'], ['currency', 'Moeda'], ['payment_method', 'Método'],
]
const money = (v: any, currency = 'BRL') => v == null ? 'N/D' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(v))
const number = (v: any) => new Intl.NumberFormat('pt-BR').format(Number(v ?? 0))
const percent = (v: any) => v == null ? 'N/D' : `${Number(v).toFixed(1).replace('.', ',')}%`
const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
const delta = (a: any, b: any) => { const x = Number(a), y = Number(b); return Number.isFinite(x) && Number.isFinite(y) && y !== 0 ? ((x - y) / Math.abs(y)) * 100 : null }

export default function DashboardProductionV2() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const today = useMemo(() => localDate(new Date()), [])
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [data, setData] = useState<Json | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Record<FilterKey, string>>({ product: '', funnel: '', gateway: '', status: '', source: '', campaign: '', currency: '', payment_method: '' })
  const minDate = useMemo(() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - 89); return localDate(d) }, [today])

  const load = useCallback(async (initial = false) => {
    if (!start || !end || start > end) { setError('O período informado é inválido.'); return }
    initial ? setLoading(true) : setRefreshing(true)
    setError(null)
    const params = Object.fromEntries(Object.entries(selected).map(([key, value]) => [`p_${key}`, value || null]))
    const { data: result, error: rpcError } = await supabase.rpc('dashboard_production_data_for_user_secure', { p_start_date: start, p_end_date: end, ...params })
    if (rpcError) { setError(rpcError.message); setData(null) } else setData((result ?? {}) as Json)
    initial ? setLoading(false) : setRefreshing(false)
  }, [end, selected, start, supabase])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    const channel = supabase.channel('dashboard-production-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_payment_attempts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load, supabase])

  const d = data ?? {}
  const currency = selected.currency || 'BRL'
  const cards = [
    ['Receita aprovada', d.financial?.revenue, d.previous?.revenue, money(d.financial?.revenue, currency), Wallet, '/dashboard/pagamentos'],
    ['Vendas aprovadas', d.sales?.approved, d.previous?.sales, number(d.sales?.approved), ShoppingCart, '/dashboard/vendas'],
    ['Conversão de checkout', d.checkouts?.conversion, d.previous?.conversion, percent(d.checkouts?.conversion), BarChart3, '/dashboard/checkouts'],
    ['Aprovação de gateway', d.gateways?.approvalRate, null, percent(d.gateways?.approvalRate), Gauge, '/dashboard/gateways'],
  ] as Array<[string, any, any, string, any, string]>
  const modules = [
    ['Vendas', [['Total', number(d.sales?.total)], ['Aprovadas', number(d.sales?.approved)], ['Pendentes', number(d.sales?.pending)], ['Recusadas', number(d.sales?.declined)], ['Ticket médio', money(d.sales?.averageTicket, currency)]], '/dashboard/vendas'],
    ['Checkouts', [['Visitas', number(d.checkouts?.visits)], ['Inícios', number(d.checkouts?.started)], ['Concluídos', number(d.checkouts?.completed)], ['Abandonados', number(d.checkouts?.abandoned)], ['Conversão', percent(d.checkouts?.conversion)]], '/dashboard/checkouts'],
    ['Clientes', [['Clientes', number(d.clients?.total)], ['Novos', number(d.clients?.new)], ['Recorrentes', number(d.clients?.recurring)], ['Ativos', number(d.clients?.active)], ['LTV', money(d.clients?.ltv, currency)]], '/dashboard/clientes'],
    ['Pagamentos', [['Aprovados', number(d.payments?.approved)], ['Recusados', number(d.payments?.declined)], ['Pendentes', number(d.payments?.pending)], ['Reembolsos', number(d.payments?.refunds)], ['Chargebacks', number(d.payments?.chargebacks)]], '/dashboard/pagamentos'],
    ['Gateways', [['Gateways', number(d.gateways?.count)], ['Tentativas', number(d.gateways?.attempts)], ['Aprovadas', number(d.gateways?.approved)], ['Falhas', number(d.gateways?.failed)], ['Taxa', percent(d.gateways?.approvalRate)]], '/dashboard/gateways'],
    ['Assinaturas', [['Total', number(d.subscriptions?.total)], ['Ativas', number(d.subscriptions?.active)], ['Trial', number(d.subscriptions?.trialing)], ['Em atraso', number(d.subscriptions?.pastDue)], ['MRR', money(d.subscriptions?.mrr, currency)]], '/dashboard/vendas'],
    ['Afiliados', [['Afiliados', number(d.affiliates?.count)], ['Vendas atribuídas', number(d.affiliates?.sales)], ['Receita atribuída', money(d.affiliates?.revenue, currency)], ['Comissões', money(d.affiliates?.commissions, currency)]]],
    ['Marketing / Atribuição', [['Leads', number(d.marketing?.leads)], ['Vendas', number(d.marketing?.sales)], ['Receita', money(d.marketing?.revenue, currency)], ['Fonte', 'Dados reais']], '/dashboard/analytics'],
    ['CRM', [['Conversas', number(d.crm?.conversations)], ['Abertas', number(d.crm?.open)], ['Não lidas', number(d.crm?.unread)], ['SLA', 'Operacional']], '/dashboard/crm'],
    ['Operações', [['Eventos', number(d.operations?.events)], ['Falhas', number(d.operations?.failed)], ['Pendentes', number(d.operations?.pending)], ['Integrações', 'Monitoradas']], '/dashboard/webhooks'],
    ['Segurança', [['Auditoria', number(d.security?.events)], ['Autenticação', number(d.security?.authEvents)], ['RLS', 'Ativo'], ['Escopo', 'Usuário']], '/dashboard/security'],
    ['Inteligência', [['Receita', money(d.intelligence?.revenue, currency)], ['Vendas', number(d.intelligence?.sales)], ['Conversão', percent(d.intelligence?.conversion)], ['Base', 'Observada']], '/dashboard/ia'],
  ] as Array<[string, Array<[string, string]>, string?]>
  const visibleModules = modules.filter(([name]) => !search.trim() || name.toLowerCase().includes(search.toLowerCase()))
  const trend: any[] = Array.isArray(d.trend) ? d.trend : []
  const maxRevenue = Math.max(1, ...trend.map((item: any) => Number(item.revenue ?? 0)))
  const clearFilters = () => setSelected({ product: '', funnel: '', gateway: '', status: '', source: '', campaign: '', currency: '', payment_method: '' })
  const exportCsv = () => {
    const rows = [['Área', 'Métrica', 'Valor']]
    visibleModules.forEach(([name, metrics]) => metrics.forEach(([label, value]) => rows.push([name, label, value])))
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `althea-dashboard-${start}-${end}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }

  return <main className="mx-auto w-full max-w-[1500px] space-y-5 px-4 pb-32 pt-5 sm:px-6 lg:px-8">
    <header className="rounded-3xl border border-white/[.07] bg-[#080a09] p-5 sm:p-6">
      <p className="text-[10px] font-black uppercase tracking-[.22em] text-[#1DB854]">ALTHEA PAY · CONTROL CENTER</p>
      <div className="mt-2 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><h1 className="text-2xl font-black">Dashboard operacional</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-[#69736e]">Visão executiva e operacional baseada exclusivamente nos dados do usuário autenticado.</p></div>
        <div className="flex flex-wrap gap-2">
          <label className="rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-bold">De <input type="date" min={minDate} max={end} value={start} onChange={e => setStart(e.target.value)} className="ml-2 bg-transparent [color-scheme:dark]" /></label>
          <label className="rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-bold">Até <input type="date" min={start} max={today} value={end} onChange={e => setEnd(e.target.value)} className="ml-2 bg-transparent [color-scheme:dark]" /></label>
          <button onClick={() => void load()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-black"><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />Atualizar</button>
          <button onClick={() => setFiltersOpen(v => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-black"><Filter size={13} />Filtros</button>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-black"><Download size={13} />CSV</button>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.06] bg-[#0b0d0c] px-3"><Search size={14} className="text-[#69736e]" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar módulo..." className="h-10 w-full bg-transparent text-xs outline-none" />{search && <button onClick={() => setSearch('')}><X size={14} /></button>}</div>
      {filtersOpen && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{FILTERS.map(([key, label]) => <label key={key} className="rounded-xl border border-white/[.05] bg-[#0a0c0b] p-3"><span className="text-[9px] font-black uppercase tracking-wider text-[#69736e]">{label}</span><select value={selected[key]} onChange={e => setSelected(current => ({ ...current, [key]: e.target.value }))} className="mt-2 w-full bg-transparent text-xs [color-scheme:dark]"><option value="">Todos</option>{(Array.isArray(d.filters?.[key]) ? d.filters[key] : []).map((value: any) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select></label>)}<button onClick={clearFilters} className="text-left text-[10px] font-black text-[#1DB854]">Limpar filtros</button></div>}
    </header>
    {error && <div className="flex gap-3 rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-xs text-red-300"><AlertTriangle size={16} /><span>{error}</span></div>}
    {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map(item => <div key={item} className="h-32 animate-pulse rounded-2xl border border-white/[.06] bg-[#080a09]" />)}</div> : <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(([label, raw, previous, value, Icon, route]) => { const change = delta(raw, previous); return <button key={label} onClick={() => router.push(route)} className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5 text-left transition hover:border-white/[.14]"><div className="flex items-center justify-between"><span className="rounded-xl bg-[#101512] p-2.5 text-[#1DB854]"><Icon size={17} /></span>{change !== null && <span className={`inline-flex items-center gap-1 text-[10px] font-black ${change >= 0 ? 'text-[#5ed98b]' : 'text-red-400'}`}>{change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(change).toFixed(1).replace('.', ',')}%</span>}</div><p className="mt-5 text-[10px] font-bold uppercase tracking-wider text-[#69736e]">{label}</p><p className="mt-1 text-2xl font-black">{value}</p><p className="mt-1 text-[9px] text-[#4f5b55]">Período anterior: {previous == null ? 'N/D' : label.includes('Receita') ? money(previous, currency) : label.includes('Conversão') ? percent(previous) : number(previous)}</p></button> })}</section>
      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-black">Receita por dia</p><p className="mt-1 text-[10px] text-[#69736e]">Série filtrada e isolada pelo usuário autenticado.</p></div><Activity size={16} className="text-[#1DB854]" /></div><div className="mt-5 flex h-48 items-end gap-1">{trend.map((item: any) => <div key={String(item.date)} title={`${item.date} · ${money(item.revenue, currency)} · ${number(item.sales)} vendas`} className="flex h-full min-w-[7px] flex-1 items-end"><div className="w-full rounded-t bg-[#1DB854]/70" style={{ height: `${Math.max(3, Number(item.revenue ?? 0) / maxRevenue * 100)}%` }} /></div>)}</div><div className="mt-3 flex justify-between text-[9px] text-[#4f5b55]"><span>{trend[0]?.date || start}</span><span>{trend.length ? trend[trend.length - 1]?.date : end}</span></div></div>
        <div className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center gap-2"><AlertTriangle size={16} className="text-[#e4b85c]" /><p className="text-sm font-black">Central de atenção</p></div><div className="mt-4 space-y-2">{[['Falhas de gateway', d.alerts?.gatewayFailures, '/dashboard/gateways'], ['Falhas operacionais', d.alerts?.failedOperations, '/dashboard/webhooks'], ['CRM não lido', d.alerts?.unreadCrm, '/dashboard/crm'], ['Disputas', d.alerts?.disputes, '/dashboard/pagamentos'], ['Assinaturas em atraso', d.alerts?.subscriptionPastDue, '/dashboard/vendas']].map(([label, value, route]: any) => <button key={label} onClick={() => router.push(route)} className="flex w-full justify-between rounded-xl border border-white/[.05] bg-[#0b0d0c] p-3 text-left"><span className="text-[10px] font-bold text-[#9aa49f]">{label}</span><span className={`text-xs font-black ${Number(value) > 0 ? 'text-[#e4b85c]' : 'text-[#5ed98b]'}`}>{number(value)}</span></button>)}</div></div>
      </section>
      <section><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-black">Mapa operacional</p><p className="mt-1 text-[10px] text-[#69736e]">Módulos conectados ao mesmo contrato de dados do Dashboard.</p></div><span className="text-[9px] font-black uppercase tracking-wider text-[#5ed98b]">Tempo real</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleModules.map(([name, metrics, route]) => <article key={name} className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-black">{name}</h2>{route && <button onClick={() => router.push(route)} className="text-[9px] font-black text-[#1DB854]">Abrir →</button>}</div><div className="mt-4 grid grid-cols-2 gap-2">{metrics.map(([label, value]) => <div key={label} className="rounded-xl border border-white/[.04] bg-[#0b0d0c] p-3"><p className="text-[9px] uppercase tracking-wider text-[#59635e]">{label}</p><p className="mt-1 truncate text-xs font-black">{value}</p></div>)}</div></article>)}</div></section>
    </>}
  </main>
}
