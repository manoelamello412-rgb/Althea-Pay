'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Download, Filter, Gauge, RefreshCw, Search, ShoppingCart, Wallet, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type FilterKey = 'product' | 'funnel' | 'gateway' | 'status' | 'source' | 'campaign' | 'currency' | 'payment_method'
type Json = Record<string, any>
type ActivityItem = { kind: 'payment' | 'customer' | 'call' | 'conversation'; at: string; id: string; status?: string; amount?: number | null; currency?: string; payment_method?: string | null; outcome?: string; channel?: string; name?: string | null }

const FILTERS: Array<[FilterKey, string]> = [
  ['product', 'Produto'], ['funnel', 'Funil'], ['gateway', 'Gateway'], ['status', 'Status'],
  ['source', 'Origem'], ['campaign', 'Campanha'], ['currency', 'Moeda'], ['payment_method', 'Método'],
]
const money = (v: any, currency = 'BRL') => v == null ? 'N/D' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(v))
const number = (v: any) => new Intl.NumberFormat('pt-BR').format(Number(v ?? 0))
const percent = (v: any) => v == null ? 'N/D' : `${Number(v).toFixed(1).replace('.', ',')}%`
const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
const PAYMENT_STATUS: Record<string, string> = { created: 'criado', pending: 'pendente', approved: 'aprovado', failed: 'falhou', declined: 'recusado', expired: 'expirado', refunded: 'reembolsado', chargeback: 'chargeback' }
const CALL_OUTCOME: Record<string, string> = { answered: 'atendeu', no_answer: 'não atendeu', busy: 'ocupado', voicemail: 'caixa postal', wrong_number: 'número errado', callback: 'pediu retorno', converted: 'fechou', not_interested: 'sem interesse' }
const ERRORS: Record<string, string> = { AUTH_REQUIRED: 'Sua sessão não tem uma organização ativa. Entre novamente.', INVALID_PERIOD: 'O período informado é inválido.' }
const activityText = (item: ActivityItem) => {
  const who = item.name || 'Cliente'
  if (item.kind === 'payment') return [`Pagamento ${PAYMENT_STATUS[item.status ?? ''] ?? item.status ?? ''}`, [who, item.amount != null ? money(item.amount, item.currency || 'BRL') : null, item.payment_method].filter(Boolean).join(' · '), `/dashboard/pagamentos?transaction=${item.id}`]
  if (item.kind === 'customer') return ['Novo cliente', who, '/dashboard/clientes']
  if (item.kind === 'call') return [`Ligação: ${CALL_OUTCOME[item.outcome ?? ''] ?? item.outcome}`, who, '/dashboard/atendimento']
  return ['Nova conversa', [who, item.channel].filter(Boolean).join(' · '), `/dashboard/crm?conversation=${item.id}`]
}
const timeAgo = (value: string) => { const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000)); return minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d` }
const delta = (a: any, b: any) => { const x = Number(a), y = Number(b); return Number.isFinite(x) && Number.isFinite(y) && y !== 0 ? ((x - y) / Math.abs(y)) * 100 : null }

export default function DashboardProduction() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const today = useMemo(() => localDate(new Date()), [])
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [data, setData] = useState<Json | null>(null)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
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
    const [{ data: result, error: rpcError }, recent] = await Promise.all([
      supabase.rpc('dashboard_production_data_for_user_secure', { p_start_date: start, p_end_date: end, ...params }),
      supabase.rpc('dashboard_recent_activity_v1', { p_limit: 12 }),
    ])
    if (rpcError) { setError(ERRORS[rpcError.message] ?? 'Não foi possível carregar o dashboard.'); setData(null) } else setData((result ?? {}) as Json)
    setActivity(recent.error ? null : ((recent.data as { items?: ActivityItem[] } | null)?.items ?? []))
    initial ? setLoading(false) : setRefreshing(false)
  }, [end, selected, start, supabase])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    const channel = supabase.channel('dashboard-production')
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
  const currencyOptions = (Array.isArray(d.filters?.currency) ? d.filters.currency : []).map((value: any) => String(value).trim().toUpperCase()).filter(Boolean)
  // With a single currency in the period every sum is already in it, so there is nothing to pick.
  const monetaryCurrency = selected.currency || (currencyOptions.length === 1 ? currencyOptions[0] : '')
  const currency = monetaryCurrency || 'BRL'
  const revenuePlaceholder = currencyOptions.length === 0 ? 'N/D' : currencyOptions.length === 1 ? `Selecione ${currencyOptions[0]}` : `${currencyOptions.length} moedas`
  const moneyMetric = (value: any) => monetaryCurrency ? money(value, currency) : '—'
  const explicitCurrencyMetric = (value: any) => monetaryCurrency ? money(value, currency) : '—'
  const realized = Number(d.financial?.realized ?? 0), pending = Number(d.financial?.pendingAmount ?? 0)
  const hiddenValues = d.can_view_values === false
  const cards = [
    ['Receita aprovada', monetaryCurrency ? d.financial?.revenue : null, monetaryCurrency ? d.previous?.revenue : null, monetaryCurrency ? money(d.financial?.revenue, currency) : revenuePlaceholder, Wallet, '/dashboard/pagamentos'],
    ['Vendas aprovadas', d.sales?.approved, d.previous?.sales, number(d.sales?.approved), ShoppingCart, '/dashboard/vendas'],
    ['Conversão de checkout', d.checkouts?.conversion, d.previous?.conversion, percent(d.checkouts?.conversion), BarChart3, '/dashboard/checkouts'],
    ['Aprovação de gateway', d.gateways?.approvalRate, null, percent(d.gateways?.approvalRate), Gauge, '/dashboard/gateways'],
  ] as Array<[string, any, any, string, any, string]>
  const modules = [
    ['Vendas', [['Total', number(d.sales?.total)], ['Aprovadas', number(d.sales?.approved)], ['Pendentes', number(d.sales?.pending)], ['Recusadas', number(d.sales?.declined)], ['Ticket médio', moneyMetric(d.sales?.averageTicket)]], '/dashboard/vendas'],
    ['Checkouts', [['Visitas', number(d.checkouts?.visits)], ['Inícios', number(d.checkouts?.started)], ['Concluídos', number(d.checkouts?.completed)], ['Abandonados', number(d.checkouts?.abandoned)], ['Conversão', percent(d.checkouts?.conversion)]], '/dashboard/checkouts'],
    ['Clientes', [['Clientes', number(d.clients?.total)], ['Novos', number(d.clients?.new)], ['Recorrentes', number(d.clients?.recurring)], ['Ativos', number(d.clients?.active)], ['LTV', moneyMetric(d.clients?.ltv)]], '/dashboard/clientes'],
    ['Pagamentos', [['Aprovados', number(d.payments?.approved)], ['Recusados', number(d.payments?.declined)], ['Pendentes', number(d.payments?.pending)], ['Reembolsos', number(d.payments?.refunds)], ['Chargebacks', number(d.payments?.chargebacks)]], '/dashboard/pagamentos'],
    ['Gateways', [['Gateways', number(d.gateways?.count)], ['Tentativas', number(d.gateways?.attempts)], ['Aprovadas', number(d.gateways?.approved)], ['Falhas', number(d.gateways?.failed)], ['Taxa', percent(d.gateways?.approvalRate)]], '/dashboard/gateways'],
    ['Assinaturas', [['Total', number(d.subscriptions?.total)], ['Ativas', number(d.subscriptions?.active)], ['Trial', number(d.subscriptions?.trialing)], ['Em atraso', number(d.subscriptions?.pastDue)], ['MRR', explicitCurrencyMetric(d.subscriptions?.mrr)]], '/dashboard/vendas'],
    ['Afiliados', [['Afiliados', number(d.affiliates?.count)], ['Vendas atribuídas', number(d.affiliates?.sales)], ['Receita atribuída', moneyMetric(d.affiliates?.revenue)], ['Comissões', '—']]],
    ['Marketing / Atribuição', [['Leads', number(d.marketing?.leads)], ['Vendas', number(d.marketing?.sales)], ['Receita', moneyMetric(d.marketing?.revenue)], ['Fonte', monetaryCurrency ? `Dados reais · ${currency}` : 'Selecione uma moeda']], '/dashboard/analytics'],
    ['CRM', [['Conversas', number(d.crm?.conversations)], ['Abertas', number(d.crm?.open)], ['Não lidas', number(d.crm?.unread)], ['SLA', 'Operacional']], '/dashboard/crm'],
    ['Operações', [['Eventos', number(d.operations?.events)], ['Falhas', number(d.operations?.failed)], ['Pendentes', number(d.operations?.pending)], ['Integrações', 'Monitoradas']], '/dashboard/webhooks'],
    ['Segurança', [['Auditoria', number(d.security?.events)], ['Autenticação', number(d.security?.authEvents)], ['RLS', 'Ativo'], ['Escopo', 'Organização']], '/dashboard/security'],
    ['Inteligência', [['Receita', moneyMetric(d.intelligence?.revenue)], ['Vendas', number(d.intelligence?.sales)], ['Conversão', percent(d.intelligence?.conversion)], ['Base', 'Observada']], '/dashboard/ia'],
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
        <div><h1 className="text-2xl font-black">Dashboard operacional</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-[#69736e]">Visão executiva e operacional com os dados reais da organização atual.</p></div>
        <div className="flex flex-wrap gap-2">
          <label className="rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-bold">De <input type="date" min={minDate} max={end} value={start} onChange={e => setStart(e.target.value)} className="ml-2 bg-transparent [color-scheme:dark]" /></label>
          <label className="rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-bold">Até <input type="date" min={start} max={today} value={end} onChange={e => setEnd(e.target.value)} className="ml-2 bg-transparent [color-scheme:dark]" /></label>
          <button onClick={() => void load()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-black"><RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />Atualizar</button>
          <button onClick={() => setFiltersOpen(v => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-black"><Filter size={13} />Filtros</button>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/[.07] bg-[#101311] px-3 py-2 text-[10px] font-black"><Download size={13} />CSV</button>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.06] bg-[#0b0d0c] px-3"><Search size={14} className="text-[#69736e]" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar módulo..." className="h-10 w-full bg-transparent text-xs outline-none" />{search && <button onClick={() => setSearch('')}><X size={14} /></button>}</div>
      {filtersOpen && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{FILTERS.map(([key, label]) => <label key={key} className="rounded-xl border border-white/[.05] bg-[#0a0c0b] p-3"><span className="text-[9px] font-black uppercase tracking-wider text-[#69736e]">{label}</span><select value={selected[key]} onChange={e => setSelected(current => ({ ...current, [key]: e.target.value }))} className="mt-2 w-full bg-transparent text-xs [color-scheme:dark]"><option value="">Todos</option>{(Array.isArray(d.filters?.[key]) ? d.filters[key] : []).map((option: any) => { const value = String(option?.value ?? option); return <option key={value} value={value}>{String(option?.label ?? (key === 'status' ? PAYMENT_STATUS[value] ?? value : value))}</option> })}</select></label>)}<button onClick={clearFilters} className="text-left text-[10px] font-black text-[#1DB854]">Limpar filtros</button></div>}
    </header>
    {error && <div className="flex gap-3 rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-xs text-red-300"><AlertTriangle size={16} /><span>{error}</span></div>}
    {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map(item => <div key={item} className="h-32 animate-pulse rounded-2xl border border-white/[.06] bg-[#080a09]" />)}</div> : <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(([label, raw, previous, value, Icon, route]) => { const change = delta(raw, previous); return <button key={label} onClick={() => router.push(route)} className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5 text-left transition hover:border-white/[.14]"><div className="flex items-center justify-between"><span className="rounded-xl bg-[#101512] p-2.5 text-[#1DB854]"><Icon size={17} /></span>{change !== null && <span className={`inline-flex items-center gap-1 text-[10px] font-black ${change >= 0 ? 'text-[#5ed98b]' : 'text-red-400'}`}>{change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(change).toFixed(1).replace('.', ',')}%</span>}</div><p className="mt-5 text-[10px] font-bold uppercase tracking-wider text-[#69736e]">{label}</p><p className="mt-1 text-2xl font-black">{value}</p><p className="mt-1 text-[9px] text-[#4f5b55]">Período anterior: {previous == null ? 'N/D' : label.includes('Receita') ? money(previous, currency) : label.includes('Conversão') ? percent(previous) : number(previous)}</p></button> })}</section>
      <section className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5">
        <div className="flex items-center justify-between"><div><p className="text-sm font-black">Realizado x pendente</p><p className="mt-1 text-[10px] text-[#69736e]">Pagamentos do período: realizado = aprovado; pendente = PIX/boleto gerado e ainda não pago.</p></div><Wallet size={16} className="text-[#1DB854]" /></div>
        {hiddenValues ? <p className="mt-4 text-xs text-[#69736e]">Seu acesso não inclui ver valores.</p> : !monetaryCurrency ? <p className="mt-4 text-xs text-[#69736e]">{currencyOptions.length ? 'Há mais de uma moeda no período: selecione uma moeda nos filtros.' : 'Nenhum pagamento no período.'}</p> : <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button onClick={() => router.push('/dashboard/pagamentos')} className="rounded-xl border border-white/[.05] bg-[#0b0d0c] p-4 text-left"><p className="text-[9px] font-bold uppercase tracking-wider text-[#59635e]">Valor total realizado</p><p className="mt-1 text-xl font-black text-[#5ed98b]">{money(realized, currency)}</p><p className="mt-1 text-[10px] text-[#69736e]">{percent(d.financial?.realizedShare)} · {number(d.financial?.realizedCount)} pagamento(s)</p></button>
            <button onClick={() => router.push('/dashboard/pagamentos')} className="rounded-xl border border-white/[.05] bg-[#0b0d0c] p-4 text-left"><p className="text-[9px] font-bold uppercase tracking-wider text-[#59635e]">Valor total pendente</p><p className="mt-1 text-xl font-black text-[#e4b85c]">{money(pending, currency)}</p><p className="mt-1 text-[10px] text-[#69736e]">{percent(d.financial?.pendingShare)} · {number(d.financial?.pending)} pagamento(s)</p></button>
            <div className="rounded-xl border border-white/[.05] bg-[#0b0d0c] p-4"><p className="text-[9px] font-bold uppercase tracking-wider text-[#59635e]">Total (realizado + pendente)</p><p className="mt-1 text-xl font-black">{money(realized + pending, currency)}</p><p className="mt-1 text-[10px] text-[#69736e]">100%</p></div>
          </div>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-white/[.05]" role="img" aria-label={`Realizado ${percent(d.financial?.realizedShare)}, pendente ${percent(d.financial?.pendingShare)}`}><div className="bg-[#1DB854]" style={{ width: `${Number(d.financial?.realizedShare ?? 0)}%` }} /><div className="bg-[#e4b85c]" style={{ width: `${Number(d.financial?.pendingShare ?? 0)}%` }} /></div>
        </>}
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <div className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-black">Receita por dia</p><p className="mt-1 text-[10px] text-[#69736e]">Série filtrada e isolada pela organização atual.</p></div><Activity size={16} className="text-[#1DB854]" /></div>{monetaryCurrency ? <><div className="mt-5 flex h-48 items-end gap-1">{trend.map((item: any) => <div key={String(item.date)} title={`${item.date} · ${money(item.revenue, currency)} · ${number(item.sales)} vendas`} className="flex h-full min-w-[7px] flex-1 items-end"><div className="w-full rounded-t bg-[#1DB854]/70" style={{ height: `${Math.max(3, Number(item.revenue ?? 0) / maxRevenue * 100)}%` }} /></div>)}</div><div className="mt-3 flex justify-between text-[9px] text-[#4f5b55]"><span>{trend[0]?.date || start}</span><span>{trend.length ? trend[trend.length - 1]?.date : end}</span></div></> : <div className="mt-5 flex h-48 items-center justify-center rounded-xl border border-dashed border-white/[.07] px-6 text-center text-xs text-[#69736e]">Selecione uma moeda nos filtros para visualizar receita e métricas monetárias sem misturar moedas.</div>}</div>
        <div className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center gap-2"><AlertTriangle size={16} className="text-[#e4b85c]" /><p className="text-sm font-black">Central de atenção</p></div><div className="mt-4 space-y-2">{[['Falhas de gateway', d.alerts?.gatewayFailures, '/dashboard/gateways'], ['Falhas operacionais', d.alerts?.failedOperations, '/dashboard/webhooks'], ['CRM não lido', d.alerts?.unreadCrm, '/dashboard/crm'], ['Disputas', d.alerts?.disputes, '/dashboard/pagamentos'], ['Assinaturas em atraso', d.alerts?.subscriptionPastDue, '/dashboard/vendas']].map(([label, value, route]: any) => <button key={label} onClick={() => router.push(route)} className="flex w-full justify-between rounded-xl border border-white/[.05] bg-[#0b0d0c] p-3 text-left"><span className="text-[10px] font-bold text-[#9aa49f]">{label}</span><span className={`text-xs font-black ${Number(value) > 0 ? 'text-[#e4b85c]' : 'text-[#5ed98b]'}`}>{number(value)}</span></button>)}</div></div>
      </section>
      <section className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-black">Atividade recente</p><p className="mt-1 text-[10px] text-[#69736e]">Pagamentos, clientes, ligações e conversas da organização.</p></div><Activity size={16} className="text-[#1DB854]" /></div>
        {activity === null ? <p className="mt-4 text-xs text-[#69736e]">Não foi possível carregar a atividade recente.</p> : activity.length === 0 ? <p className="mt-4 text-xs text-[#69736e]">Nenhuma atividade registrada ainda.</p>
          : <ul className="mt-4 divide-y divide-white/[.05]">{activity.map(item => { const [title, detail, href] = activityText(item); return <li key={`${item.kind}-${item.id}-${item.at}`}><button onClick={() => router.push(href)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-white/[.02]"><span className="min-w-0"><b className="block truncate text-xs">{title}</b><span className="block truncate text-[10px] text-[#69736e]">{detail}</span></span><span className="shrink-0 text-[10px] text-[#69736e]">há {timeAgo(item.at)}</span></button></li> })}</ul>}
      </section>
      <section><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-black">Mapa operacional</p><p className="mt-1 text-[10px] text-[#69736e]">Módulos conectados ao mesmo contrato de dados do Dashboard.</p></div><span className="text-[9px] font-black uppercase tracking-wider text-[#5ed98b]">Tempo real</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleModules.map(([name, metrics, route]) => <article key={name} className="rounded-2xl border border-white/[.07] bg-[#080a09] p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-black">{name}</h2>{route && <button onClick={() => router.push(route)} className="text-[9px] font-black text-[#1DB854]">Abrir →</button>}</div><div className="mt-4 grid grid-cols-2 gap-2">{metrics.map(([label, value]) => <div key={label} className="rounded-xl border border-white/[.04] bg-[#0b0d0c] p-3"><p className="text-[9px] uppercase tracking-wider text-[#59635e]">{label}</p><p className="mt-1 truncate text-xs font-black">{value}</p></div>)}</div></article>)}</div></section>
    </>}
  </main>
}
