import Link from 'next/link'
import {
  ArrowUpRight,
  Blocks,
  Bot,
  Database,
  GitBranch,
  KeyRound,
  Network,
  Webhook,
} from 'lucide-react'

const integrations = [
  { title: 'Gateways', description: 'Conexões, credenciais, testes e troca operacional de provedores.', href: '/dashboard/gateways', icon: Network, tag: 'PAYMENTS' },
  { title: 'Funis', description: 'Conexão, eventos, tracking e controle remoto de funis.', href: '/dashboard/funil', icon: GitBranch, tag: 'FUNNELS' },
  { title: 'Webhooks', description: 'Entrada, saída, segredos e telemetria de entregas.', href: '/dashboard/webhooks', icon: Webhook, tag: 'EVENTS' },
  { title: 'API', description: 'Chaves, escopos e auditoria das chamadas da API pública.', href: '/dashboard/api', icon: KeyRound, tag: 'API' },
  { title: 'IARA', description: 'Assistente e inteligência conectada aos dados operacionais.', href: '/dashboard/ia', icon: Bot, tag: 'AI' },
  { title: 'Configurações', description: 'Identidade, organização e controles da conta.', href: '/dashboard/settings', icon: Database, tag: 'CORE' },
]

export default function IntegrationHubPage() {
  return (
    <div className="w-full space-y-6">
      <section className="border-b border-white/[.055] pb-5">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">
          <Blocks size={13} />
          Ecossistema
        </p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Integration Hub</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
          Ponto único de acesso às integrações da Althea Pay. Cada domínio mantém sua responsabilidade e seus dados reais; o Hub apenas organiza a navegação.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map(({ title, description, href, icon: Icon, tag }) => (
          <Link
            key={href}
            href={href}
            className="group min-h-[174px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(29,184,84,.16)]"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
                <Icon size={17} />
              </span>
              <ArrowUpRight size={16} className="text-[#536159] transition group-hover:text-[var(--althea-brand)]" />
            </div>
            <div className="mt-5 text-[8px] font-semibold uppercase tracking-[.18em] text-[#65746c]">{tag}</div>
            <h2 className="mt-1 text-sm font-semibold text-white">{title}</h2>
            <p className="mt-2 text-[10px] leading-4 text-[var(--althea-muted)]">{description}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}
