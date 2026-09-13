'use client'

import { useMemo, useState } from 'react'
import { BookOpen, ChevronDown, ExternalLink, Search, ShieldCheck, Zap } from 'lucide-react'

const articles = [
  { title: 'Visão geral da operação', text: 'O ALTHEA PAY centraliza a operação: Funis, Produtos, Checkouts, Gateways externos, Vendas, Clientes, CRM, IA, Automações e Analytics. O processamento financeiro continua nos gateways contratados.' },
  { title: 'Gateways e pagamentos', text: 'Cadastre e monitore conexões no Centro de Gateways. O Checkout referencia a configuração de processamento; o ALTHEA PAY não substitui o gateway nem mantém custódia de valores.' },
  { title: 'Webhooks e sincronização', text: 'Eventos externos entram pela infraestrutura de integração e podem alimentar vendas, clientes, checkouts e automações. Use Webhooks para acompanhar entregas, tentativas e respostas HTTP.' },
  { title: 'API', text: 'As credenciais e logs da API ficam no módulo API. Chaves privadas não devem ser compartilhadas, inseridas no frontend ou expostas em URLs.' },
  { title: 'Segurança', text: 'Use Configurações > Segurança para senha e MFA TOTP. Ative MFA para contas administrativas e mantenha as credenciais fora do código-fonte.' },
]

export default function HelpPage() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(articles[0].title)
  const filtered = useMemo(() => articles.filter(article => `${article.title} ${article.text}`.toLowerCase().includes(query.trim().toLowerCase())), [query])

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-[1200px]">
      <header className="mb-8"><div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400"><BookOpen size={14} /> ALTHEA PAY // CENTRAL DE AJUDA</div><h1 className="text-3xl font-black tracking-tight">Central de ajuda</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Referência operacional para entender como os módulos se conectam sem duplicar infraestrutura.</p></header>
      <label className="mb-6 flex h-12 max-w-2xl items-center gap-3 rounded-xl border border-white/10 bg-white/[.025] px-4 text-slate-500"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="Buscar assunto, módulo ou operação..." /></label>
      <section className="mb-6 grid gap-3 md:grid-cols-3"><a href="/dashboard/gateways" className="rounded-2xl border border-white/10 bg-white/[.025] p-5 transition hover:bg-white/[.05]"><Zap size={18} className="mb-4 text-emerald-400" /><b className="block">Gateways</b><span className="mt-1 block text-xs text-slate-500">Conexões e saúde dos processadores externos.</span></a><a href="/dashboard/api" className="rounded-2xl border border-white/10 bg-white/[.025] p-5 transition hover:bg-white/[.05]"><ExternalLink size={18} className="mb-4 text-emerald-400" /><b className="block">API</b><span className="mt-1 block text-xs text-slate-500">Credenciais, escopos e observabilidade de requests.</span></a><a href="/dashboard/security" className="rounded-2xl border border-white/10 bg-white/[.025] p-5 transition hover:bg-white/[.05]"><ShieldCheck size={18} className="mb-4 text-emerald-400" /><b className="block">Segurança</b><span className="mt-1 block text-xs text-slate-500">Autenticação, senha e MFA da conta.</span></a></section>
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">{filtered.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Nenhum artigo encontrado.</div> : filtered.map(article => <article key={article.title} className="border-b border-white/[.06] last:border-0"><button type="button" onClick={() => setOpen(current => current === article.title ? null : article.title)} className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left"><b>{article.title}</b><ChevronDown size={17} className={open === article.title ? 'rotate-180 transition' : 'transition'} /></button>{open === article.title && <p className="max-w-4xl px-5 pb-5 text-sm leading-7 text-slate-400">{article.text}</p>}</article>)}</section>
    </div>
  </main>
}
