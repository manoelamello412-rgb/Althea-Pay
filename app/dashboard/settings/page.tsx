'use client'

import { useRouter } from 'next/navigation'
import {
  Activity,
  Building2,
  GitBranch,
  KeyRound,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  Webhook,
} from 'lucide-react'

const sections = [
  {
    title: 'Conta e acesso',
    items: [
      { label: 'Perfil', description: 'Identidade, avatar e dados pessoais.', href: '/dashboard/settings/perfil', icon: UserRound },
      { label: 'Segurança', description: 'Senha, MFA e sessões da conta.', href: '/dashboard/security', icon: ShieldCheck },
      { label: 'Membros e acessos', description: 'Vínculos e papéis reais da organização.', href: '/dashboard/members', icon: UsersRound },
    ],
  },
  {
    title: 'Operação',
    items: [
      { label: 'Minha Empresa', description: 'Cadastro jurídico, fiscal e operacional.', href: '/dashboard/settings/empresa', icon: Building2 },
      { label: 'Gateways', description: 'Conexões, credenciais e testes de gateways.', href: '/dashboard/gateways', icon: Network },
      { label: 'Funil e domínio', description: 'Conexão, domínio, eventos e chat do funil.', href: '/dashboard/funil', icon: GitBranch },
      { label: 'Recuperação', description: 'Políticas de recuperação operacional.', href: '/dashboard/settings/recuperacao', icon: RefreshCw },
      { label: 'Desempenho', description: 'Saúde, latência e telemetria da operação.', href: '/dashboard/settings/desempenho', icon: Activity },
    ],
  },
  {
    title: 'Inteligência e integrações',
    items: [
      { label: 'Iara', description: 'Preferências do assistente e limites de atuação.', href: '/dashboard/settings/iara', icon: Sparkles },
      { label: 'Integrações', description: 'Webhooks de saída e segredos de integração.', href: '/dashboard/webhooks', icon: Webhook },
      { label: 'API', description: 'Chaves e documentação da API operacional.', href: '/dashboard/api', icon: KeyRound },
    ],
  },
] as const

export default function SettingsPage() {
  const router = useRouter()

  return (
    <div className="w-full space-y-6">
      <section className="border-b border-white/[.055] pb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Administração</p>
        <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Configurações</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
          Organize a conta, a operação e as integrações em uma única central. Cada item leva para a área canônica correspondente, sem formulários duplicados.
        </p>
      </section>

      {sections.map(section => (
        <section key={section.title} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{section.title}</h2>
            <div className="mt-1 h-px w-10 bg-[rgba(29,184,84,.28)]" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {section.items.map(({ label, description, href, icon: Icon }) => (
              <button
                key={href}
                type="button"
                onClick={() => router.push(href)}
                className="group min-h-[138px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(29,184,84,.16)]"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-[rgba(29,184,84,.10)] bg-[rgba(29,184,84,.055)] text-[var(--althea-brand)]">
                  <Icon size={17} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-white">{label}</h3>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">{description}</p>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
