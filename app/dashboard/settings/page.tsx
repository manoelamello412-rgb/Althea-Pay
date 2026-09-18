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
      { label: 'Funil e domínio', description: 'Conexão, domínio, eventos e chat do funil.', href: '/dashboard/settings/funil-dominio', icon: GitBranch },
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
    <main className="min-h-screen bg-[#07090d] px-4 pb-32 pt-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#1DB854]">
            <ShieldCheck size={14} /> ALTHEA PAY // CONFIGURAÇÕES
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Central de configurações</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
            Cada área possui uma única tela canônica. Esta página apenas organiza os acessos e não mantém formulários paralelos.
          </p>
        </header>

        {sections.map(section => (
          <section key={section.title} className="space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">{section.title}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map(({ label, description, href, icon: Icon }) => (
                <button
                  key={href}
                  type="button"
                  onClick={() => router.push(href)}
                  className="group min-h-[132px] rounded-2xl border border-white/[0.07] bg-[#0F1A16]/55 p-5 text-left transition hover:border-[#1DB854]/25 hover:bg-[#0F1A16]"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#1DB854]/15 bg-[#1DB854]/[0.06] text-[#1DB854]">
                    <Icon size={18} />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-white">{label}</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
