'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Filter, LayoutGrid, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, any>
type FilterKey = 'product' | 'funnel' | 'gateway' | 'status' | 'source' | 'campaign' | 'currency' | 'payment_method'
type Module = { id: string; title: string; description: string; route?: string; metrics: Array<[string, string]> }

const STORAGE_KEY = 'althea:dashboard:visible-modules:v2'
const filters: Array<[FilterKey, string]> = [
  ['product', 'Produto'], ['funnel', 'Funil'], ['gateway', 'Gateway'], ['status', 'Status'],
  ['source', 'Origem'], ['campaign', 'Campanha'], ['currency', 'Moeda'], ['payment_method', 'Método de pagamento'],
]
const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
const number = (v: number) => new Intl.NumberFormat('pt-BR').format(Number(v || 0))
const percent = (v: number) => `${Number(v || 0).toFixed(1).replace('.', ',')}%`

export default function DashboardOperationalMap() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [data, setData] = useState<Json | null>(null)
  const [selected, setSelected] = useState<Record<FilterKey, string>>({ product: '', funnel: '', gateway: '', status: '', source: '', campaign: '', currency: '', payment_method: '' })
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), [])
  const minDate = useMemo(() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - 89); return new Intl.DateTimeFormat('en-CA').format(d) }, [today])

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
    if (rpcError) { setError(rpcError.message); setData(null) } else setData(result as Json)
    setLoading(false)
  }, [endDate, selected, startDate, supabase])

  useEffect(() => { void load() }, [load])

  const f = data?.filters ?? {}
  const value = (key: FilterKey) => selected[key]
  const setFilter = (key: FilterKey, v: string) => setSelected((s) => ({ ...s, [key]: v }))
  const clearFilters = () => setSelected({ product: '', funnel: '', gateway: '', status: '', source: '', campaign: '', currency: '', payment_method: '' })

  const modules = useMemo<Module[]>(() => {
    const d = data ?? {}
    return [
      { id: 'financeiro', title: 'Financeiro', description: 'Visão financeira consolidada.', route: '/dashboard/financeiro', metrics: [['Receita aprovada', money(d.financial?.revenue)], ['Aprovadas', number(d.financial?.approved)], ['Pendentes', number(d.financial?.pending)], ['Reembolsos', number(d.financial?.refunds)], ['Valor reembolsado', money(d.financial?.refundAmount)], ['Disputas', number(d.financial?.disputes)], ['Valor em disputa', money(d.financial?.disputeAmount)]] },
      { id: 'vendas', title: 'Vendas', description: 'Estados e desempenho das vendas.', route: '/dashboard/vendas', metrics: [['Total', number(d.sales?.total)], ['Aprovadas', number(d.sales?.approved)], ['Pendentes', number(d.sales?.pending)], ['Recusadas', number(d.sales?.declined)], ['Canceladas', number(d.sales?.cancelled)], ['Reembolsadas', number(d.sales?.refunded)], ['Chargebacks', number(d.sales?.chargebacks)], ['Ticket médio', money(d.sales?.averageTicket)]] },
      { id: 'funis', title: 'Funis', description: 'Performance comercial dos funis.', route: '/dashboard/funil', metrics: [['Funis ativos', number(d.funnels?.total)], ['Visitas de checkout', number(d.funnels?.visits)], ['Leads', number(d.funnels?.leads)], ['Vendas', number(d.funnels?.sales)], ['Receita', money(d.funnels?.revenue)]] },
      { id: 'checkouts', title: 'Checkouts', description: 'Jornada real de checkout.', route: '/dashboard/checkout', metrics: [['Visitas', number(d.checkouts?.visits)], ['Inícios', number(d.checkouts?.started)], ['Concluídos', number(d.checkouts?.completed)], ['Abandonados', number(d.checkouts?.abandoned)], ['Conversão', percent(d.checkouts?.conversion)]] },
      { id: 'produtos', title: 'Produtos', description: 'Desempenho derivado das vendas.', metrics: [['Vendas', number(d.products?.sales)], ['Receita', money(d.products?.revenue)], ['Ticket médio', money(d.products?.averageTicket)]] },
      { id: 'clientes', title: 'Clientes', description: 'Base de clientes no período.', route: '/dashboard/clientes', metrics: [['Clientes no período', number(d.clients?.total)], ['Novos', number(d.clients?.new)], ['Recorrentes', number(d.clients?.recurring)], ['Ativos', number(d.clients?.active)], ['Retenção', percent(d.clients?.retention)], ['Recompra', percent(d.clients?.repurchase)], ['LTV', money(d.clients?.ltv)]] },
      { id: 'pagamentos', title: 'Pagamentos', description: 'Estado operacional das transações.', route: '/dashboard/pagamentos', metrics: [['Aprovados', number(d.payments?.approved)], ['Recusados', number(d.payments?.declined)], ['Pendentes', number(d.payments?.pending)], ['Cancelados', number(d.payments?.cancelled)], ['Reembolsos', number(d.payments?.refunds)], ['Chargebacks', number(d.payments?.chargebacks)]] },
      { id: 'gateways', title: 'Gateways', description: 'Processamento e aprovação.', route: '/dashboard/gateways', metrics: [['Gateways usados', number(d.gateways?.count)], ['Tentativas', number(d.gateways?.attempts)], ['Aprovadas', number(d.gateways?.approved)], ['Falhas', number(d.gateways?.failed)], ['Taxa de aprovação', percent(d.gateways?.approvalRate)]] },
      { id: 'assinaturas', title: 'Assinaturas', description: 'Não existe fonte de assinatura disponível no schema atual.', metrics: [['Status da fonte', 'Indisponível'], ['Motivo', 'Fonte de assinatura não disponível']] },
      { id: 'afiliados', title: 'Afiliados', description: 'Parceiros e comissões reais.', route: '/dashboard/afiliados', metrics: [['Afiliados', number(d.affiliates?.count)], ['Vendas atribuídas', number(d.affiliates?.sales)], ['Receita', money(d.affiliates?.revenue)], ['Comissões', money(d.affiliates?.commissions)]] },
      { id: 'marketing', title: 'Marketing / Atribuição', description: 'Origem e atribuição das entradas.', metrics: [['Leads', number(d.marketing?.leads)], ['Vendas', number(d.marketing?.sales)], ['Receita', money(d.marketing?.revenue)]] },
      { id: 'crm', title: 'CRM', description: 'Resumo operacional do relacionamento.', route: '/dashboard/crm', metrics: [['Conversas', number(d.crm?.conversations)], ['Abertas', number(d.crm?.open)], ['Não lidas', number(d.crm?.unread)]] },
      { id: 'operacoes', title: 'Operações', description: 'Eventos e processamento de integrações.', metrics: [['Eventos', number(d.operations?.events)], ['Falhas', number(d.operations?.failed)], ['Pendentes', number(d.operations?.pending)]] },
      { id: 'seguranca', title: 'Segurança', description: 'Atividade administrativa auditável.', metrics: [['Eventos de auditoria', number(d.security?.events)], ['Eventos de autenticação', number(d.security?.authEvents)]] },
      { id: 'atividade', title: 'Atividade recente', description: 'Contagem de eventos auditados no período.', metrics: [['Eventos registrados', number(d.activity?.events)]] },
      { id: 'alertas', title: 'Alertas', description: 'Estados que exigem atenção.', metrics: [['Falhas operacionais', number(d.alerts?.failedOperations)], ['Falhas de gateway', number(d.alerts?.gatewayFailures)], ['CRM não lido', number(d.alerts?.unreadCrm)], ['Disputas', number(d.alerts?.disputes)]] },
      { id: 'inteligencia', title: 'Inteligência', description: 'Indicadores derivados exclusivamente de dados reais.', route: '/dashboard/ia', metrics: [['Receita', money(d.intelligence?.revenue)], ['Vendas', number(d.intelligence?.sales)], ['Conversão', percent(d.intelligence?.conversion)]] },
    ]
  }, [data])

  const visible = modules.filter((m) => !hidden.includes(m.id) && (!query.trim() || `${m.title} ${m.description} ${m.metrics.map((x) => x[0]).join(' ')}`.toLowerCase().includes(query.toLowerCase())))
  const toggle = (id: string) => setExpanded((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  return <section className="mx-auto w-full max-w-[1440px] space-y-5 px-4 pb-32 sm:px-6 lg:px-8">
    <div className="rounded-3xl border border-white/[0.06] bg-[#080a09] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#1DB854]">Centro operacional</p><h2 className="mt-1 text-xl font-black">Visão completa da plataforma</h2><p className="mt-1 text-xs text-[#69736e]">Todos os indicadores abaixo são calculados a partir das fontes reais do ALTHEA PAY.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFilterOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Filter size={14}/> Filtros</button><button type="button" onClick={() => setCustomizeOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Settings2 size={14}/> Personalizar</button></div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#0b0d0c] px-3"><Search size={15} className="text-[#69736e]"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar área ou métrica..." className="h-11 w-full bg-transparent text-xs outline-none" aria-label="Pesquisar área ou métrica"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><X size={14}/></button>}</div>
      {filterOpen && <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0d100e] p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{filters.map(([key,label]) => { const options = Array.isArray(f[key]) ? f[key] : []; return <label key={key} className="rounded-xl border border-white/[0.05] bg-[#0a0c0b] p-3"><span className="block text-[9px] font-black uppercase tracking-[0.12em] text-[#69736e]">{label}</span><select value={value(key)} onChange={(e) => setFilter(key,e.target.value)} className="mt-2 w-full bg-transparent text-xs outline-none [color-scheme:dark]"><option value="">Todos</option>{options.map((o: any) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select></label>})}</div><div className="mt-3 flex justify-end"><button type="button" onClick={clearFilters} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-[10px] font-bold"><RotateCcw size={12}/> Limpar filtros</button></div></div>}
      {customizeOpen && <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0d100e] p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold">Áreas visíveis</p><p className="mt-1 text-[10px] text-[#69736e]">A preferência é salva neste dispositivo.</p></div><button type="button" onClick={() => setHidden([])} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-[10px] font-bold"><RotateCcw size={12}/> Restaurar</button></div><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{modules.map((m) => <button type="button" key={m.id} onClick={() => setHidden((s) => s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s,m.id])} className="shrink-0 rounded-full border border-white/[0.06] px-3 py-2 text-[10px] text-[#9aa49f]">{hidden.includes(m.id) ? 'Mostrar ' : 'Ocultar '}{m.title}</button>)}</div></div>}
    </div>
    {error && <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-xs text-red-300">Não foi possível carregar os indicadores: {error}</div>}
    {loading ? <div className="grid gap-4 lg:grid-cols-2">{Array.from({length:6}).map((_,i)=><div key={i} className="h-32 animate-pulse rounded-2xl border border-white/[0.06] bg-[#080a09]"/>)}</div> : <div className="grid gap-4 lg:grid-cols-2">{visible.map((m) => { const open = expanded.includes(m.id); return <article key={m.id} className="rounded-2xl border border-white/[0.06] bg-[#080a09] p-4"><button type="button" onClick={() => toggle(m.id)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left"><div><div className="flex items-center gap-2"><LayoutGrid size={15} className="text-[#1DB854]"/><h3 className="text-sm font-bold">{m.title}</h3></div><p className="mt-1 text-[10px] leading-5 text-[#69736e]">{m.description}</p></div>{open ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</button>{open && <div className="mt-4 border-t border-white/[0.05] pt-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{m.metrics.map(([label,val])=><div key={label} className="rounded-xl border border-white/[0.05] bg-[#0d100e] p-3"><span className="block text-[9px] uppercase tracking-wide text-[#69736e]">{label}</span><strong className="mt-1 block text-sm font-bold text-white">{val}</strong></div>)}</div>{m.route && <button type="button" onClick={() => router.push(m.route!)} className="mt-3 rounded-xl bg-[#1DB854] px-4 py-2.5 text-[10px] font-black text-[#07110c]">Abrir módulo</button>}</div>}</article>})}</div>}
    {!loading && !visible.length && <div className="rounded-2xl border border-white/[0.06] bg-[#080a09] p-10 text-center"><p className="text-sm font-bold">Nenhuma área encontrada</p><p className="mt-1 text-xs text-[#69736e]">Ajuste a pesquisa ou restaure as áreas ocultas.</p></div>}
  </section>
}
