'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownToLine, ChevronRight, GripVertical, Plus, RotateCcw, Settings2, SlidersHorizontal, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Section = { id: string; title: string; items: string[] }
type Filter = { id: string; label: string; options: string[] }

const sections: Section[] = [
  { id: 'financeiro', title: 'Desempenho financeiro', items: ['Evolução da receita', 'Receita bruta × líquida', 'Entradas', 'Taxas', 'Comissões', 'Reembolsos', 'Chargebacks', 'Valores pendentes', 'Valores disponíveis'] },
  { id: 'vendas', title: 'Desempenho de vendas', items: ['Evolução das vendas', 'Vendas por período', 'Ticket médio', 'Aprovação', 'Recusa', 'Cancelamento', 'Reembolso', 'Produtos com maior desempenho'] },
  { id: 'funis', title: 'Performance dos funis', items: ['Funis com melhor desempenho', 'Visitas', 'Leads', 'Conversão', 'Abandono', 'Vendas', 'Receita', 'Performance por etapa'] },
  { id: 'checkouts', title: 'Performance dos checkouts', items: ['Checkouts', 'Visitas', 'Inícios', 'Pagamentos iniciados', 'Aprovações', 'Abandonos', 'Conversão', 'Receita'] },
  { id: 'produtos', title: 'Produtos', items: ['Produtos com maior venda', 'Produtos com maior receita', 'Ticket médio', 'Conversão', 'Reembolsos', 'Chargebacks', 'Crescimento'] },
  { id: 'clientes', title: 'Clientes', items: ['Total', 'Novos', 'Recorrentes', 'Ativos', 'Compradores', 'Retenção', 'Recompra', 'LTV', 'Evolução da base'] },
  { id: 'pagamentos', title: 'Pagamentos', items: ['Aprovação', 'Recusa', 'Pendência', 'Cancelamento', 'Reembolso', 'Chargeback', 'Métodos de pagamento', 'Performance dos pagamentos'] },
  { id: 'gateways', title: 'Gateways', items: ['Volume processado', 'Aprovação', 'Recusa', 'Falhas', 'Erros', 'Latência', 'Performance', 'Distribuição das transações'] },
  { id: 'assinaturas', title: 'Assinaturas', items: ['Assinaturas ativas', 'Novas', 'Canceladas', 'Renovações', 'MRR', 'ARR', 'Churn', 'Falhas de cobrança', 'Recuperações'] },
  { id: 'afiliados', title: 'Afiliados', items: ['Vendas', 'Receita', 'Conversão', 'Comissões', 'Ranking', 'Performance'] },
  { id: 'marketing', title: 'Marketing / atribuição', items: ['Origem', 'Canal', 'Campanha', 'UTM', 'Leads', 'Vendas', 'Receita', 'Conversão'] },
  { id: 'crm', title: 'CRM', items: ['Leads', 'Conversas', 'Pendências', 'Oportunidades', 'Negociações', 'Conversões', 'Tempo de resposta'] },
  { id: 'operacoes', title: 'Operações', items: ['Webhooks', 'Eventos', 'Filas', 'Jobs', 'Integrações', 'Falhas', 'Retentativas', 'Processamentos pendentes'] },
  { id: 'seguranca', title: 'Segurança', items: ['Acessos', 'Sessões', 'Falhas de autenticação', 'Alterações administrativas', 'Eventos de segurança', 'Atividades críticas'] },
  { id: 'atividade', title: 'Atividade recente', items: ['Ação', 'Usuário', 'Entidade', 'Data/hora', 'Resultado', 'Contexto'] },
  { id: 'alertas', title: 'Alertas', items: ['Financeiros', 'Pagamentos', 'Gateways', 'Funis', 'Checkouts', 'Integrações', 'Segurança', 'Operações'] },
  { id: 'inteligencia', title: 'Inteligência', items: ['Insights', 'Anomalias', 'Tendências', 'Gargalos', 'Oportunidades', 'Recomendações', 'Alertas inteligentes'] },
]

const filters: Filter[] = [
  { id: 'produto', label: 'Produto', options: ['Todos'] }, { id: 'oferta', label: 'Oferta', options: ['Todas'] }, { id: 'funil', label: 'Funil', options: ['Todos'] }, { id: 'checkout', label: 'Checkout', options: ['Todos'] }, { id: 'gateway', label: 'Gateway', options: ['Todos'] }, { id: 'metodo', label: 'Método de pagamento', options: ['Todos'] }, { id: 'afiliado', label: 'Afiliado', options: ['Todos'] }, { id: 'campanha', label: 'Campanha', options: ['Todas'] }, { id: 'origem', label: 'Origem', options: ['Todas'] }, { id: 'status', label: 'Status', options: ['Todos'] }, { id: 'moeda', label: 'Moeda', options: ['BRL'] },
]

const kpis = [
  ['Receita bruta', '—'], ['Receita líquida', '—'], ['Vendas', '—'], ['Ticket médio', '—'], ['Conversão', '—'], ['Clientes', '—'], ['Novos clientes', '—'], ['Clientes recorrentes', '—'], ['Pagamentos aprovados', '—'], ['Pagamentos recusados', '—'], ['Reembolsos', '—'], ['Chargebacks', '—'], ['Saldo disponível', '—'], ['Valores pendentes', '—'], ['Receita recorrente', '—'],
]

function Widget({ title, items, onOpen }: { title: string; items: string[]; onOpen: () => void }) {
  return <article className="rounded-2xl border border-white/[0.06] bg-[#0b0d0c] p-4 transition hover:border-white/[0.11]">
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-white">{title}</p><p className="mt-1 text-[10px] text-[#69736e]">Dados reais do módulo responsável, respeitando os filtros globais.</p></div><button type="button" onClick={onOpen} className="rounded-lg p-2 text-[#69736e] hover:bg-white/[0.04] hover:text-white" aria-label={`Abrir ${title}`}><ChevronRight size={16}/></button></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{items.slice(0, 6).map((item) => <button key={item} type="button" onClick={onOpen} className="rounded-xl border border-white/[0.05] bg-[#101311] p-3 text-left text-[10px] text-[#9aa49f] hover:border-white/[0.1] hover:text-white"><span className="block truncate">{item}</span><span className="mt-2 block text-base font-bold text-white">—</span></button>)}</div>
  </article>
}

export default function DashboardComplete() {
  const router = useRouter()
  const [period, setPeriod] = useState('Hoje')
  const [compare, setCompare] = useState('Anterior')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [hidden, setHidden] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')

  const visibleSections = useMemo(() => sections.filter((section) => !hidden.includes(section.id) && (!search.trim() || `${section.title} ${section.items.join(' ')}`.toLowerCase().includes(search.toLowerCase()))), [hidden, search])
  const toggleHidden = (id: string) => setHidden((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const reset = () => { setHidden([]); setPeriod('Hoje'); setCompare('Anterior'); setValues({}); setSearch('') }

  const go = (id: string) => {
    const routes: Record<string, string> = { vendas: '/dashboard/vendas', funis: '/dashboard/funil', produtos: '/dashboard/produtos', clientes: '/dashboard/clientes', pagamentos: '/dashboard/pagamentos', gateways: '/dashboard/gateways', crm: '/dashboard/crm', checkouts: '/dashboard/checkout', afiliados: '/dashboard/afiliados', financeiro: '/dashboard/financeiro' }
    const route = routes[id]
    if (route) router.push(route)
  }

  return <main className="min-h-screen bg-[#020303] pb-32 text-white"><div className="mx-auto max-w-[1440px] space-y-5 p-4 sm:p-6 lg:p-8">
    <header className="flex flex-col gap-4 rounded-3xl border border-white/[0.06] bg-[#080a09] p-5 lg:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-400">ALTHEA PAY / CONTROL CENTER</p><h1 className="mt-2 text-3xl font-black tracking-tight">Dashboard</h1><p className="mt-1 text-xs text-[#69736e]">Visão unificada da operação financeira, comercial e operacional.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setPeriod(period === 'Hoje' ? 'Últimos 7 dias' : 'Hoje')} className="rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold">Período: {period}</button><select value={compare} onChange={(e) => setCompare(e.target.value)} className="rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs"><option>Anterior</option><option>Sem comparação</option></select><button type="button" onClick={() => setFiltersOpen(!filtersOpen)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><SlidersHorizontal size={14}/> Filtros</button><button type="button" onClick={() => setCustomizing(!customizing)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Settings2 size={14}/> Personalizar</button><button type="button" onClick={() => window.location.reload()} className="rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold">Atualizar</button><button type="button" onClick={() => { const blob = new Blob([JSON.stringify({ period, compare, filters: values }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'althea-dashboard.json'; a.click(); URL.revokeObjectURL(url) }} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><ArrowDownToLine size={14}/> Exportar</button></div></div>
      {filtersOpen && <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{filters.map((filter) => <label key={filter.id} className="rounded-xl border border-white/[0.06] bg-[#0e100f] p-3"><span className="block text-[9px] font-mono uppercase tracking-wider text-[#69736e]">{filter.label}</span><select value={values[filter.id] ?? filter.options[0]} onChange={(e) => setValues((current) => ({ ...current, [filter.id]: e.target.value }))} className="mt-2 w-full bg-transparent text-xs outline-none"><option>{filter.options[0]}</option></select></label>)}</div>}
      {customizing && <div className="mt-2 rounded-2xl border border-white/[0.06] bg-[#0e100f] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Personalização</p><p className="text-[10px] text-[#69736e]">Ocultar ou restaurar widgets do seu painel.</p></div><button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-xs font-bold"><RotateCcw size={13}/> Restaurar padrão</button></div><div className="mt-3 flex flex-wrap gap-2">{sections.map((section) => <button key={section.id} type="button" onClick={() => toggleHidden(section.id)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] ${hidden.includes(section.id) ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300' : 'border-white/[0.06] text-[#9aa49f]'}`}><GripVertical size={12}/>{section.title}{hidden.includes(section.id) && <X size={12}/>}</button>)}</div></div>}
    </header>

    <section className="flex flex-col gap-3 sm:flex-row"><div className="flex-1"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no Dashboard..." className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#0b0d0c] px-4 text-xs outline-none focus:border-emerald-500/30" /></div><div className="flex gap-2 overflow-x-auto pb-1">{['Vendas','Funis','Produtos','Clientes','Pagamentos','Gateways'].map((label) => <button key={label} type="button" onClick={() => go(label.toLowerCase())} className="whitespace-nowrap rounded-xl border border-white/[0.06] bg-[#0b0d0c] px-4 py-2 text-xs font-bold">{label}</button>)}</div></section>

    <section className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">{kpis.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.06] bg-[#0b0d0c] p-4"><p className="text-[9px] font-mono uppercase tracking-wider text-[#69736e]">{label}</p><p className="mt-3 text-xl font-black">{value}</p><p className="mt-1 text-[9px] text-[#69736e]">Aguardando dado real</p></div>)}</section>

    <section className="grid gap-4 lg:grid-cols-2">{visibleSections.map((section) => <Widget key={section.id} title={section.title} items={section.items} onOpen={() => go(section.id)} />)}</section>
  </div></main>
}
