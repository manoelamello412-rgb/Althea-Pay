'use client'

import { Building2, ChevronRight, CircleDollarSign, FileText, Globe2, RefreshCcw, ShieldCheck, Users, Webhook } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import PerfilSettingsPage from '@/app/dashboard/settings/perfil/page'
import EmpresaSettingsPage from '@/app/dashboard/settings/empresa/page'
import IntegracoesSettingsPage from '@/app/dashboard/settings/integracoes/page'
import LogoutButton from '@/components/ui/logout-button'

type SubPage = 'menu' | 'perfil' | 'empresa' | 'integracoes'

type SettingItem = {
  label: string
  description: string
  icon: typeof Users
  target: 'empresa' | 'desempenho' | 'vendas' | 'funil' | 'recuperacao' | 'usuarios' | 'integracoes' | 'seguranca'
}

const items: SettingItem[] = [
  { label: 'Minha Empresa', description: 'Dados jurídicos, fiscais e cadastrais da operação', icon: Building2, target: 'empresa' },
  { label: 'Desempenho', description: 'Telemetria, disponibilidade e tempo de resposta', icon: RefreshCcw, target: 'desempenho' },
  { label: 'Vendas', description: 'Auditoria transacional e acompanhamento da operação', icon: CircleDollarSign, target: 'vendas' },
  { label: 'Funil e Domínio', description: 'URLs, domínios e infraestrutura dos funis', icon: Globe2, target: 'funil' },
  { label: 'Recuperação', description: 'Réguas para carrinhos, PIX expirado e boleto', icon: Webhook, target: 'recuperacao' },
  { label: 'Usuários', description: 'Acessos, equipe e permissões da operação', icon: Users, target: 'usuarios' },
  { label: 'Integrações', description: 'APIs, tokens e webhooks para sistemas externos', icon: FileText, target: 'integracoes' },
  { label: 'Segurança & Auditoria', description: 'Autenticação, proteção e trilhas de acesso', icon: ShieldCheck, target: 'seguranca' },
]

export default function SettingsMobile() {
  const router = useRouter()
  const [currentSubPage, setCurrentSubPage] = useState<SubPage>('menu')

  function openItem(item: SettingItem) {
    if (item.target === 'empresa') return setCurrentSubPage('empresa')
    if (item.target === 'integracoes') return setCurrentSubPage('integracoes')

    const routes: Record<Exclude<SettingItem['target'], 'empresa' | 'integracoes'>, string> = {
      desempenho: '/dashboard/settings/desempenho',
      vendas: '/dashboard/settings/vendas',
      funil: '/dashboard/settings/funil-dominio',
      recuperacao: '/dashboard/settings/recuperacao',
      usuarios: '/dashboard/settings/usuarios',
      seguranca: '/dashboard/settings/seguranca',
    }
    router.push(routes[item.target])
  }

  function pageContent(): ReactNode {
    if (currentSubPage === 'perfil') return <PerfilSettingsPage />
    if (currentSubPage === 'empresa') return <EmpresaSettingsPage />
    if (currentSubPage === 'integracoes') return <IntegracoesSettingsPage />

    return (
      <>
        <header className="pr-20">
          <h1 className="text-2xl font-black tracking-tight text-white">Configurações</h1>
          <p className="mt-1 text-xs font-medium text-zinc-500">Gerencie as diretrizes gerais da sua operação</p>
        </header>

        <button type="button" onClick={() => setCurrentSubPage('perfil')} aria-label="Meu Perfil" className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl bg-[#0E1110] px-4 text-left text-sm font-bold text-white transition-all duration-200 active:scale-[0.99]">
          <span>Meu Perfil</span><ChevronRight size={18} className="text-zinc-600" />
        </button>

        <section className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => {
            const Icon = item.icon
            return <button key={item.label} type="button" onClick={() => openItem(item)} className="flex w-full items-center justify-between gap-4 rounded-xl bg-[#0E1110] p-4 text-left transition-all duration-200 active:scale-[0.99]">
              <span className="flex min-w-0 items-center gap-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#111312] text-zinc-400"><Icon size={18} strokeWidth={1.8} /></span><span className="min-w-0"><strong className="block text-sm font-bold text-white">{item.label}</strong><small className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">{item.description}</small></span></span>
              <ChevronRight size={18} className="shrink-0 text-zinc-600" />
            </button>
          })}
        </section>
      </>
    )
  }

  const subPage = currentSubPage !== 'menu'

  return <section className="relative min-h-[500px] space-y-5 pb-32 font-['Space_Grotesk'] text-white" aria-label="Configurações mobile">
    <div className="absolute right-0 top-0 z-50"><LogoutButton /></div>
    {subPage && <button type="button" onClick={() => setCurrentSubPage('menu')} className="pr-24 text-xs font-bold text-zinc-500 transition hover:text-white">← Voltar</button>}
    <div className={subPage ? 'pr-24' : ''}>{pageContent()}</div>
  </section>
}
