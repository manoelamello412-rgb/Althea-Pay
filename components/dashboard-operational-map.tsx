'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Filter, LayoutGrid, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, any>
type FilterKey = 'product' | 'funnel' | 'gateway' | 'status' | 'source' | 'campaign' | 'currency' | 'payment_method'
type Module = { id: string; title: string; description: string; route?: string; metrics: Array<[string, string]> }

const STORAGE_KEY = 'althea:dashboard:visible-modules:v3'
const FILTERS: Array<[FilterKey, string]> = [
  ['product', 'Produto'], ['funnel', 'Funil'], ['gateway', 'Gateway'], ['status', 'Status'],
  ['source', 'Origem'], ['campaign', 'Campanha'], ['currency', 'Moeda'], ['payment_method', 'Método de pagamento'],
]
const number = (v: unknown) => new Intl.NumberFormat('pt-BR').format(Number(v ?? 0))
const money = (v: unknown, currency = 'BRL') => {
  const n = Number(v ?? 0)
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n) } catch { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n) }
}
const percent = (v: unknown) => `${Number(v ?? 0).toFixed(1).replace('.', ',')}%`

export default function DashboardOperationalMap() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [data, setData] = useState<Json | null>(null)
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selected, setSelected] = useState<Record<FilterKey, string>>({ product: '', funnel: '', gateway: '', status: '', source: '', campaign: '', currency: '', payment_method: '' })

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), [])
  const minDate = useMemo(() => {
    const d = new Date(`${today}T12:00:00`)
    d.setDate(d.getDate() - 89)
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
  }, [today])

  useEffect(() => {
    setStartDate(today); setEndDate(today)
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) setHidden(JSON.parse(raw))
    } catch {}
  }, [today])

  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden)) } catch {} }, [hidden])

  const load = useCallback(async () => {
    if (!startDate || !endDate || startDate > endDate) return
    setLoading(true); setError(null)
    const { data: result, error: rpcError } = await supabase.rpc('dashboard_operational_data_for_user', {
      p_start_date: startDate, p_end_date: endDate,
      p_product: selected.product || null, p_funnel: selected.funnel || null, p_gateway: selected.gateway || null,
      p_status: selected.status || null, p_source: selected.source || null, p_campaign: selected.campaign || null,
      p_currency: selected.currency || null, p_payment_method: selected.payment_method || null,
    })
    if (rpcError) { setError(rpcError.message); setData(null) } else setData((result ?? {}) as Json)
    setLoading(false)
  }, [endDate, selected, startDate, supabase])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!startDate || !endDate) return
    const channel = supabase.channel('dashboard-operational-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_payment_attempts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load, startDate, endDate, supabase])

  const f = data?.filters ?? {}
  const setFilter = (key: FilterKey, value: string) => setSelected((s) => ({ ...s, [key]: value }))
  const clearFilters = () => setSelected({ product: '', funnel: '', gateway: '', status: '', source: '', campaign: '', currency: '', payment_method: '' })
  const currency = selected.currency || 'BRL'

  const modules = useMemo<Module[]>(() => {
    const d = data ?? {}
    return [
      { id: 'financeiro', title: 'Financeiro', description: 'Receita, aprovações, reembolsos e disputas.', route: '/dashboard/financeiro', metrics: [['Receita aprovada', money(d.financial?.revenue, currency)], ['Aprovadas', number(d.financial?.approved)], ['Pendentes', number(d.financial?.pending)], ['Reembolsos', number(d.financial?.refunds)], ['Valor reembolsado', money(d.financial?.refundAmount, currency)], ['Disputas', number(d.financial?.disputes)], ['Valor em disputa', money(d.financial?.disputeAmount, currency)]] },
      { id: 'vendas', title: 'Vendas', description: 'Estados e desempenho das vendas.', route: '/dashboard/vendas', metrics: [['Total', number(d.sales?.total)], ['Aprovadas', number(d.sales?.approved)], ['Pendentes', number(d.sales?.pending)], ['Recusadas', number(d.sales?.declined)], ['Canceladas', number(d.sales?.cancelled)], ['Reembolsadas', number(d.sales?.refunded)], ['Chargebacks', number(d.sales?.chargebacks)], ['Ticket médio', money(d.sales?.averageTicket, currency)]] },
      { id: 'funis', title: 'Funis', description: 'Funis ativos e tráfego comercial medido.', route: '/dashboard/funil', metrics: [['Funis ativos', number(d.funnels?.total)], ['Visitas de checkout', number(d.funnels?.visits)], ['Leads', number(d.funnels?.leads)], ['Vendas', number(d.funnels?.sales)], ['Receita', money(d.funnels?.revenue, currency)]] },
      { id: 'checkouts', title: 'Checkouts', description: 'Jornada de checkout baseada em sessões reais.', route: '/dashboard/checkout', metrics: [['Visitas', number(d.checkouts?.visits)], ['Inícios', number(d.checkouts?.started)], ['Concluídos', number(d.checkouts?.completed)], ['Abandonados', number(d.checkouts?.abandoned)], ['Conversão', percent(d.checkouts?.conversion)]] },
      { id: 'produtos', title: 'Produtos', description: 'Desempenho comercial derivado de vendas aprovadas.', route: '/dashboard/produtos', metrics: [['Vendas', number(d.products?.sales)], ['Receita', money(d.products?.revenue, currency)], ['Ticket médio', money(d.products?.averageTicket, currency)]] },
      { id: 'clientes', title: 'Clientes', description: 'Métricas calculadas a partir da identidade e do histórico de compras.', route: '/dashboard/clientes', metrics: [['Clientes no período', number(d.clients?.total)], ['Novos', number(d.clients?.new)], ['Recorrentes', number(d.clients?.recurring)], ['Ativos', number(d.clients?.active)], ['Retenção', percent(d.clients?.retention)], ['Recompra', percent(d.clients?.repurchase)], ['LTV', money(d.clients?.ltv, currency)]] },
      { id: 'pagamentos', title: 'Pagamentos', description: 'Estado operacional das transações.', route: '/dashboard/pagamentos', metrics: [['Aprovados', number(d.payments?.approved)], ['Recusados', number(d.payments?.declined)], ['Pendentes', number(d.payments?.pending)], ['Cancelados', number(d.payments?.cancelled)], ['Reembolsos', number(d.payments?.refunds)], ['Chargebacks', number(d.payments?.chargebacks)]] },
      { id: 'gateways', title: 'Gateways', description: 'Tentativas, falhas e taxa de aprovação do processamento.', route: '/dashboard/gateways', metrics: [['Gateways usados', number(d.gateways?.count)], ['Tentativas', number(d.gateways?.attempts)], ['Aprovadas', number(d.gateways?.approved)], ['Falhas', number(d.gateways?.failed)], ['Taxa de aprovação', percent(d.gateways?.approvalRate)]] },
      { id: 'assinaturas', title: 'Assinaturas', description: 'Domínio de assinaturas recorrentes conectado ao banco.', route: '/dashboard/assinaturas', metrics: [['Total', number(d.subscriptions?.total)], ['Ativas', number(d.subscriptions?.active)], ['Em teste', number(d.subscriptions?.trialing)], ['Em atraso', number(d.subscriptions?.pastDue)], ['Pausadas', number(d.subscriptions?.paused)], ['Canceladas no período', number(d.subscriptions?.canceled)], ['MRR', money(d.subscriptions?.mrr, currency)], ['ARR', money(d.subscriptions?.arr, currency)]] },
      { id: 'afiliados', title: 'Afiliados', description: 'Parceiros, vendas atribuídas e comissões registradas.', route: '/dashboard/afiliados', metrics: [['Afiliados', number(d.affiliates?.count)], ['Vendas atribuídas', number(d.affiliates?.sales)], ['Receita', money(d.affiliates?.revenue, currency)], ['Comissões', money(d.affiliates?.commissions, currency)]] },
      { id: 'marketing', title: 'Marketing / Atribuição', description: 'Leads e receita vinculados às origens registradas.', route: '/dashboard/marketing', metrics: [['Leads', number(d.marketing?.leads)], ['Vendas', number(d.marketing?.sales)], ['Receita', money(d.marketing?.revenue, currency)]] },
      { id: 'crm', title: 'CRM', description: 'Resumo operacional do relacionamento com clientes.', route: '/dashboard/crm', metrics: [['Conversas', number(d.crm?.conversations)], ['Abertas', number(d.crm?.open)], ['Não lidas', number(d.crm?.unread)]] },
      { id: 'operacoes', title: 'Operações', description: 'Eventos de integração e fila operacional.', route: '/dashboard/operacoes', metrics: [['Eventos', number(d.operations?.events)], ['Falhas', number(d.operations?.failed)], ['Pendentes', number(d.operations?.pending)]] },
      { id: 'seguranca', title: 'Segurança', description: 'Atividade administrativa registrada em auditoria.', route: '/dashboard/seguranca', metrics: [['Eventos de auditoria', number(d.security?.events)], ['Eventos de autenticação', number(d.security?.authEvents)]] },
      { id: 'atividade', title: 'Atividade recente', description: 'Eventos de auditoria registrados no período.', route: '/dashboard/atividade', metrics: [['Eventos registrados', number(d.activity?.events)]] },
      { id: 'alertas', title: 'Alertas', description: 'Indicadores operacionais que merecem atenção.', route: '/dashboard/alertas', metrics: [['Falhas operacionais', number(d.alerts?.failedOperations)], ['Falhas de gateway', number(d.alerts?.gatewayFailures)], ['CRM não lido', number(d.alerts?.unreadCrm)], ['Disputas', number(d.alerts?.disputes)], ['Assinaturas em atraso', number(d.alerts?.subscriptionPastDue)]] },
      { id: 'inteligencia', title: 'Inteligência', description: 'Indicadores derivados exclusivamente de fontes observadas.', route: '/dashboard/ia', metrics: [['Receita', money(d.intelligence?.revenue, currency)], ['Vendas', number(d.intelligence?.sales)], ['Conversão', percent(d.intelligence?.conversion)]] },
    ]
  }, [currency, data])

  const visible = modules.filter((m) => !hidden.includes(m.id) && (!query.trim() || `${m.title} ${m.description} ${m.metrics.map(([k,v]) => `${k} ${v}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())))
  const toggle = (id: string) => setExpanded((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  return <section className="mx-auto w-full max-w-[1440px] space-y-5 px-4 pb-32 sm:px-6 lg:px-8">
    <div className="rounded-3xl border border-white/[0.06] bg-[#080a09] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#1DB854]">Centro operacional</p><h2 className="mt-1 text-xl font-black">Visão completa da plataforma</h2><p className="mt-1 text-xs text-[#69736e]">Indicadores calculados a partir das fontes reais e atualizados em tempo real quando suportado.</p></div>
        <div className="flex flex-wrap gap-2"><label className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold">De <input type="date" min={minDate} max={endDate || today} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-xs outline-none [color-scheme:dark]" /></label><label className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold">Até <input type="date" min={startDate || minDate} max={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-xs outline-none [color-scheme:dark]" /></label><button type="button" onClick={() => setFilterOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Filter size={14}/> Filtros</button><button type="button" onClick={() => setCustomizeOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Settings2 size={14}/> Personalizar</button></div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#0b0d0c] px-3"><Search size={15} className="text-[#69736e]"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar área ou métrica..." className="h-11 w-full bg-transparent text-xs outline-none" aria-label="Pesquisar área ou métrica"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><X size={14}/></button>}</div>
      {filterOpen && <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0d100e] p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{FILTERS.map(([key,label]) => { const options = Array.isArray(f[key]) ? f[key] : []; return <label key={key} className="rounded-xl border border-white/[0.05] bg-[#0a0c0b] p-3"><span className="block text-[9px] font-black uppercase tracking-[0.12em] text-[#69736e]">{label}</span><select value={selected[key]} onChange={(e) => setFilter(key,e.target.value)} className="mt-2 w-full bg-transparent text-xs outline-none [color-scheme:dark]"><option value="">Todos</option>{options.map((o: any) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select></label>})}</div><div className="mt-3 flex justify-end"><button type="button" onClick={clearFilters} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-[10px] font-bold"><RotateCcw size={12}/> Limpar filtros</button></div></div>}
      {customizeOpen && <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0d100e] p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Áreas visíveis</p><p className="mt-1 text-[10px] text-[#69736e]">A preferência fica salva neste dispositivo.</p></div><button type="button" onClick={() => setHidden([])} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-[10px] font-bold"><RotateCcw size={12}/> Restaurar</button></div><div className="mt-3 flex flex-wrap gap-2">{modules.map((m) => <button type="button" key={m.id} onClick={() => setHidden((s) => s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s,m.id])} className="rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-[#9aa49f]">{hidden.includes(m.id) ? 'Mostrar ' : 'Ocultar '}{m.title}</button>)}</div></div>}
    </div>
    {error && <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-xs text-red-300">Não foi possível carregar os indicadores: {error}</div>}
    {loading ? <div className="grid gap-4 lg:grid-cols-2">{Array.from({length:6}).map((_,i)=><div key={i} className="h-36 animate-pulse rounded-2xl border border-white/[0.06] bg-[#080a09]"/>)}</div> : <div className="grid gap-4 lg:grid-cols-2">{visible.map((m) => { const open = expanded.includes(m.id); return <article key={m.id} className="rounded-2xl border border-white/[0.06] bg-[#080a09] p-4"><div className="flex items-start gap-3"><button type="button" onClick={() => toggle(m.id)} aria-expanded={open} className="mt-0.5 rounded-lg p-1 text-[#69736e] hover:bg-white/[0.04]">{open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button><button type="button" onClick={() => m.route && router.push(m.route)} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2"><LayoutGrid size={15} className="text-[#1DB854]"/><h3 className="text-sm font-black">{m.title}</h3></div><p className="mt-1 text-[10px] leading-4 text-[#69736e]">{m.description}</p></button></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{m.metrics.slice(0, open ? m.metrics.length : 4).map(([label,value]) => <div key={label} className="rounded-xl border border-white/[0.05] bg-[#0b0d0c] p-3"><p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#69736e]">{label}</p><p className="mt-1 break-words text-sm font-black text-[#e7ece9]">{value}</p></div>)}</div>{m.route && <div className="mt-3 text-[9px] font-black uppercase tracking-[0.12em] text-[#4f5b55]">Abrir módulo →</div>}</article> })}</div>}
    {!loading && !visible.length && <div className="rounded-2xl border border-white/[0.06] bg-[#080a09] p-10 text-center text-xs text-[#69736e]">Nenhuma área corresponde à pesquisa ou configuração atual.</div>}
    <div className="flex items-center justify-between px-1 text-[9px] uppercase tracking-[0.12em] text-[#4f5b55]"><span>{visible.length} de {modules.length} áreas visíveis</span><span>Fonte: Supabase · {data?.measuredAt ? new Date(data.measuredAt).toLocaleTimeString('pt-BR') : '—'}</span></div>
  </section>
}
