'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Filter, LayoutGrid, RotateCcw, Search, Settings2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Module = { id: string; title: string; description: string; route?: string; functions: string[] }

const modules: Module[] = [
  { id: 'financeiro', title: 'Financeiro', description: 'Visão financeira consolidada sem duplicar a gestão do módulo financeiro.', route: '/dashboard/financeiro', functions: ['Evolução da receita', 'Bruta × líquida', 'Taxas', 'Comissões', 'Reembolsos', 'Chargebacks', 'Pendente × disponível'] },
  { id: 'vendas', title: 'Vendas', description: 'Acompanhamento das vendas e seus estados operacionais.', route: '/dashboard/vendas', functions: ['Evolução', 'Ticket médio', 'Aprovação', 'Recusa', 'Cancelamento', 'Reembolso', 'Produtos'] },
  { id: 'funis', title: 'Funis', description: 'Performance comercial dos funis sem duplicar suas entidades.', route: '/dashboard/funil', functions: ['Visitas', 'Leads', 'Conversão', 'Abandono', 'Vendas', 'Receita', 'Performance por etapa'] },
  { id: 'checkouts', title: 'Checkouts', description: 'Indicadores da jornada de checkout.', route: '/dashboard/checkout', functions: ['Checkouts', 'Visitas', 'Inícios', 'Pagamentos iniciados', 'Aprovações', 'Abandonos', 'Conversão'] },
  { id: 'produtos', title: 'Produtos', description: 'Desempenho do catálogo e das ofertas.', route: '/dashboard/produtos', functions: ['Vendas', 'Receita', 'Ticket médio', 'Conversão', 'Reembolsos', 'Chargebacks', 'Crescimento'] },
  { id: 'clientes', title: 'Clientes', description: 'Resumo da base de clientes e comportamento de compra.', route: '/dashboard/clientes', functions: ['Total', 'Novos', 'Recorrentes', 'Ativos', 'Retenção', 'Recompra', 'LTV'] },
  { id: 'pagamentos', title: 'Pagamentos', description: 'Estado operacional das transações.', route: '/dashboard/pagamentos', functions: ['Aprovados', 'Recusados', 'Pendentes', 'Cancelados', 'Reembolsos', 'Chargebacks', 'Métodos'] },
  { id: 'gateways', title: 'Gateways', description: 'Saúde e distribuição do processamento, sem duplicar a Central de Gateways.', route: '/dashboard/gateways', functions: ['Volume', 'Aprovação', 'Recusa', 'Falhas', 'Erros', 'Latência', 'Distribuição'] },
  { id: 'assinaturas', title: 'Assinaturas', description: 'Operação de recorrência quando houver dados de assinatura conectados.', functions: ['Ativas', 'Novas', 'Canceladas', 'Renovações', 'MRR', 'ARR', 'Churn', 'Recuperações'] },
  { id: 'afiliados', title: 'Afiliados', description: 'Atribuição e desempenho de parceiros.', route: '/dashboard/afiliados', functions: ['Vendas', 'Receita', 'Conversão', 'Comissões', 'Ranking', 'Performance'] },
  { id: 'marketing', title: 'Marketing / Atribuição', description: 'Origem comercial e atribuição sem fabricar dados de campanha.', functions: ['Origem', 'Canal', 'Campanha', 'UTM', 'Leads', 'Vendas', 'Receita', 'Conversão'] },
  { id: 'crm', title: 'CRM', description: 'Resumo operacional do relacionamento com clientes.', route: '/dashboard/crm', functions: ['Leads', 'Conversas', 'Pendências', 'Oportunidades', 'Negociações', 'Conversões', 'Tempo de resposta'] },
  { id: 'operacoes', title: 'Operações', description: 'Observabilidade de eventos, integrações e processamento.', functions: ['Webhooks', 'Eventos', 'Filas', 'Jobs', 'Integrações', 'Falhas', 'Retentativas', 'Pendências'] },
  { id: 'seguranca', title: 'Segurança', description: 'Visibilidade de acesso e atividades críticas.', functions: ['Acessos', 'Sessões', 'Falhas de autenticação', 'Alterações administrativas', 'Eventos de segurança', 'Atividades críticas'] },
  { id: 'atividade', title: 'Atividade recente', description: 'Linha operacional preparada para eventos reais e auditoria.', functions: ['Ação', 'Usuário', 'Entidade', 'Data/hora', 'Resultado', 'Contexto'] },
  { id: 'alertas', title: 'Alertas', description: 'Central de alertas baseada em estados reais da plataforma.', functions: ['Financeiros', 'Pagamentos', 'Gateways', 'Funis', 'Checkouts', 'Integrações', 'Segurança', 'Operações'] },
  { id: 'inteligencia', title: 'Inteligência', description: 'Camada preparada para análises derivadas de dados reais.', route: '/dashboard/ia', functions: ['Insights', 'Anomalias', 'Tendências', 'Gargalos', 'Oportunidades', 'Recomendações', 'Alertas inteligentes'] },
]

export default function DashboardOperationalMap() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [hidden, setHidden] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string[]>([])

  const visible = useMemo(() => modules.filter((module) => !hidden.includes(module.id) && (!query.trim() || `${module.title} ${module.description} ${module.functions.join(' ')}`.toLowerCase().includes(query.toLowerCase()))), [hidden, query])
  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const reset = () => setHidden([])

  return <section className="mx-auto w-full max-w-[1440px] space-y-5 px-4 pb-32 sm:px-6 lg:px-8">
    <div className="rounded-3xl border border-white/[0.06] bg-[#080a09] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#1DB854]">Centro operacional</p><h2 className="mt-1 text-xl font-black">Visão completa da plataforma</h2><p className="mt-1 text-xs text-[#69736e]">Cada área abaixo representa uma responsabilidade real do ALTHEA PAY. Métricas só aparecem quando houver fonte de dados.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFilterOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Filter size={14}/> Filtros</button><button type="button" onClick={() => setCustomizeOpen((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#101311] px-3 py-2 text-xs font-bold"><Settings2 size={14}/> Personalizar</button></div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#0b0d0c] px-3"><Search size={15} className="shrink-0 text-[#69736e]"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar área ou função..." className="h-11 w-full bg-transparent text-xs outline-none" /></div>
      {filterOpen && <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0d100e] p-4 text-xs text-[#9aa49f]">Os filtros específicos de cada domínio serão alimentados pelos seus próprios contratos de dados. O Dashboard não cria opções que ainda não possuem fonte.</div>}
      {customizeOpen && <div className="mt-3 rounded-2xl border border-white/[0.06] bg-[#0d100e] p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">Áreas visíveis</p><button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.07] px-3 py-2 text-[10px] font-bold"><RotateCcw size={12}/> Restaurar</button></div><div className="mt-3 flex flex-wrap gap-2">{modules.map((module) => <button type="button" key={module.id} onClick={() => setHidden((current) => current.includes(module.id) ? current.filter((id) => id !== module.id) : [...current, module.id])} className={`rounded-full border px-3 py-2 text-[10px] ${hidden.includes(module.id) ? 'border-[#1DB854]/30 text-[#1DB854]' : 'border-white/[0.06] text-[#9aa49f]'}`}>{hidden.includes(module.id) ? 'Mostrar ' : 'Ocultar '}{module.title}</button>)}</div></div>}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">{visible.map((module) => { const isExpanded = expanded.includes(module.id); return <article key={module.id} className="rounded-2xl border border-white/[0.06] bg-[#080a09] p-4"><button type="button" onClick={() => toggle(module.id)} className="flex w-full items-start justify-between gap-3 text-left"><div><div className="flex items-center gap-2"><LayoutGrid size={15} className="text-[#1DB854]"/><h3 className="text-sm font-bold">{module.title}</h3></div><p className="mt-1 text-[10px] leading-5 text-[#69736e]">{module.description}</p></div>{isExpanded ? <ChevronDown size={17} className="shrink-0 text-[#69736e]"/> : <ChevronRight size={17} className="shrink-0 text-[#69736e]"/>}</button>{isExpanded && <div className="mt-4 border-t border-white/[0.05] pt-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{module.functions.map((item) => <button type="button" key={item} onClick={() => module.route && router.push(module.route)} className="rounded-xl border border-white/[0.05] bg-[#0d100e] p-3 text-left hover:border-white/[0.1]"><span className="block text-[10px] font-semibold text-[#aeb7b2]">{item}</span><span className="mt-2 block text-[9px] text-[#69736e]">Fonte real do módulo</span></button>)}</div>{module.route && <button type="button" onClick={() => router.push(module.route!)} className="mt-3 rounded-xl bg-[#1DB854] px-4 py-2.5 text-[10px] font-black text-[#07110c]">Abrir módulo</button>}</div>}</article> })}</div>
    {!visible.length && <div className="rounded-2xl border border-white/[0.06] bg-[#080a09] p-10 text-center"><p className="text-sm font-bold">Nenhuma área encontrada</p><p className="mt-1 text-xs text-[#69736e]">Ajuste a pesquisa ou restaure as áreas ocultas.</p></div>}
  </section>
}
