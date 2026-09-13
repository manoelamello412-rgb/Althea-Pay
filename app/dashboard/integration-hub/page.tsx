'use client'

import Link from 'next/link'
import { ArrowUpRight, Blocks, Bot, Cable, CreditCard, Database, Globe2, KeyRound, Webhook } from 'lucide-react'

const integrations = [
  { title: 'Gateways', description: 'Conexões e contratos de provedores de pagamento.', href: '/dashboard/gateways', icon: CreditCard, tag: 'PAYMENTS' },
  { title: 'Funis', description: 'Origens, conexões e ingestão de eventos dos funis.', href: '/dashboard/funis', icon: Globe2, tag: 'FUNNELS' },
  { title: 'Webhooks', description: 'Entrada e saída de eventos para integrações externas.', href: '/dashboard/webhooks', icon: Webhook, tag: 'EVENTS' },
  { title: 'API', description: 'Superfície de integração programática da operação.', href: '/dashboard/api', icon: KeyRound, tag: 'API' },
  { title: 'CRM / Chat', description: 'Conversas, clientes e automações conectadas à operação.', href: '/dashboard/crm', icon: Cable, tag: 'CRM' },
  { title: 'IA', description: 'Camada de inteligência conectada aos dados operacionais.', href: '/dashboard/ia', icon: Bot, tag: 'AI' },
  { title: 'Configurações', description: 'Identidade, organização e controles da conta.', href: '/dashboard/settings', icon: Database, tag: 'CORE' },
]

export default function IntegrationHubPage() {
  return (
    <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
      <div className="mx-auto max-w-[1700px]">
        <header className="mb-8">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400"><Blocks size={14} /> ALTHEA PAY // INTEGRATION HUB</div>
          <h1 className="text-3xl font-black tracking-tight">Integration Hub</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Ponto único para operar as integrações da ALTHEA PAY. Cada domínio mantém sua própria responsabilidade; este hub apenas centraliza o acesso.</p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {integrations.map(({ title, description, href, icon: Icon, tag }) => (
            <Link key={href} href={href} className="group rounded-2xl border border-white/10 bg-white/[.025] p-5 transition hover:border-white/20 hover:bg-white/[.04]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] text-slate-300"><Icon size={19} /></div>
                <ArrowUpRight size={17} className="text-slate-700 transition group-hover:text-slate-300" />
              </div>
              <div className="mt-6 text-[10px] font-black uppercase tracking-[.2em] text-slate-600">{tag}</div>
              <h2 className="mt-1 text-lg font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  )
}
