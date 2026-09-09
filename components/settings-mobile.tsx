'use client'

import { Building2, CircleDollarSign, FileText, Globe2, KeyRound, RefreshCcw, ShieldCheck, Users, Webhook, UserRound, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import LogoutButton from '@/components/ui/logout-button'

type SettingItem = {
  label: string
  description: string
  icon: typeof Users
  target: string
}

const items: SettingItem[] = [
  { label: 'Meu Perfil', description: 'Identidade, avatar e dados da conta', icon: UserRound, target: '/dashboard/settings/perfil' },
  { label: 'Minha Empresa', description: 'Dados jurídicos, fiscais e cadastrais da operação', icon: Building2, target: '/dashboard/settings/empresa' },
  { label: 'Segurança', description: 'Senha, MFA e sessões autenticadas', icon: ShieldCheck, target: '/dashboard/settings/seguranca' },
  { label: 'Desempenho', description: 'Telemetria, disponibilidade e tempo de resposta', icon: RefreshCcw, target: '/dashboard/settings/desempenho' },
  { label: 'Vendas', description: 'Auditoria transacional e acompanhamento da operação', icon: CircleDollarSign, target: '/dashboard/settings/vendas' },
  { label: 'Funil e Domínio', description: 'URLs, domínios e infraestrutura dos funis', icon: Globe2, target: '/dashboard/settings/funil-dominio' },
  { label: 'Recuperação', description: 'Réguas para checkout e recuperação de conversões', icon: Webhook, target: '/dashboard/settings/recuperacao' },
  { label: 'Usuários', description: 'Acessos, equipe e permissões da operação', icon: Users, target: '/dashboard/settings/usuarios' },
  { label: 'Integrações', description: 'APIs, tokens e webhooks para sistemas externos', icon: FileText, target: '/dashboard/settings/integracoes' },
  { label: 'IA', description: 'Configurações da inteligência operacional', icon: KeyRound, target: '/dashboard/settings/iara' },
]

export default function SettingsMobile() {
  const router = useRouter()

  return (
    <section className="relative min-h-[500px] space-y-5 pb-32 font-['Space_Grotesk'] text-white" aria-label="Configuração">
      <div className="absolute right-0 top-0 z-50"><LogoutButton /></div>

      <header className="pr-20">
        <h1 className="text-2xl font-black tracking-tight text-white">Configuração</h1>
        <p className="mt-1 text-xs font-medium text-zinc-500">Gerencie as diretrizes gerais da sua operação</p>
      </header>

      <section className="flex flex-col gap-1.5">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.target}
              type="button"
              onClick={() => router.push(item.target)}
              className="flex min-h-16 w-full items-center justify-between gap-4 rounded-xl bg-[#0E1110] p-4 text-left transition-all duration-200 hover:bg-[#111512] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB854]/50"
              aria-label={`Abrir ${item.label}`}
            >
              <span className="flex min-w-0 items-center gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#111312] text-zinc-400">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-bold text-white">{item.label}</strong>
                  <small className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">{item.description}</small>
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-zinc-600" />
            </button>
          )
        })}
      </section>
    </section>
  )
}
