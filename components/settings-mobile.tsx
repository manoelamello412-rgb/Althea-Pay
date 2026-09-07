'use client'

import { Building2, ChevronRight, CircleDollarSign, FileText, Globe2, LogOut, RefreshCcw, ShieldCheck, UserRound, Users, Webhook, Network } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import PerfilSettingsPage from '@/app/dashboard/settings/perfil/page'
import EmpresaSettingsPage from '@/app/dashboard/settings/empresa/page'
import IntegracoesSettingsPage from '@/app/dashboard/settings/integracoes/page'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type SubPage = 'menu' | 'perfil' | 'empresa' | 'integracoes'

type SettingItem = {
  label: string
  description: string
  icon: typeof UserRound
  target: 'perfil' | 'empresa' | 'integracoes' | 'recuperacao' | 'funil' | 'usuarios' | 'gateways' | 'seguranca' | 'desempenho' | 'vendas'
}

const items: SettingItem[] = [
  { label: 'Minha Empresa', description: 'Dados jurídicos, fiscais e cadastrais da operação', icon: Building2, target: 'empresa' },
  { label: 'Desempenho', description: 'Telemetria, disponibilidade e tempo de resposta', icon: RefreshCcw, target: 'desempenho' },
  { label: 'Vendas', description: 'Auditoria transacional e acompanhamento da operação', icon: CircleDollarSign, target: 'vendas' },
  { label: 'Funil e Domínio', description: 'URLs, domínios e infraestrutura dos funis', icon: Globe2, target: 'funil' },
  { label: 'Recuperação', description: 'Réguas para carrinhos, PIX expirado e boleto', icon: Webhook, target: 'recuperacao' },
  { label: 'Usuários', description: 'Acessos, equipe e permissões da operação', icon: Users, target: 'usuarios' },
  { label: 'Gateways', description: 'Provedores, prioridades e configurações de pagamento', icon: Network, target: 'gateways' },
  { label: 'Integrações', description: 'APIs, tokens e webhooks para sistemas externos', icon: FileText, target: 'integracoes' },
  { label: 'Segurança & Auditoria', description: 'Autenticação, proteção e trilhas de acesso', icon: ShieldCheck, target: 'seguranca' },
]

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'U'
}

export default function SettingsMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [currentSubPage, setCurrentSubPage] = useState<SubPage>('menu')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let mounted = true
    void db.auth.getUser().then(({ data }) => {
      if (!mounted || !data.user) return
      const metadata = data.user.user_metadata ?? {}
      setName(String(metadata.full_name ?? metadata.name ?? metadata.display_name ?? ''))
      setEmail(data.user.email ?? '')
      setAvatarUrl(String(metadata.avatar_url ?? metadata.picture ?? ''))
    })
    return () => { mounted = false }
  }, [db])

  async function logout() {
    setNotice('Encerrando sessão…')
    const { error } = await db.auth.signOut()
    if (error) {
      setNotice(error.message)
      return
    }
    router.replace('/login')
  }

  function openItem(item: SettingItem) {
    setNotice('')
    if (item.target === 'perfil') return setCurrentSubPage('perfil')
    if (item.target === 'empresa') return setCurrentSubPage('empresa')
    if (item.target === 'integracoes') return setCurrentSubPage('integracoes')

    const routes: Record<Exclude<SettingItem['target'], 'perfil' | 'empresa' | 'integracoes'>, string> = {
      recuperacao: '/dashboard/settings/recuperacao',
      funil: '/dashboard/settings/funil-dominio',
      usuarios: '/dashboard/settings/usuarios',
      gateways: '/dashboard/settings/gateways',
      seguranca: '/dashboard/settings/seguranca',
      desempenho: '/dashboard/desempenho',
      vendas: '/dashboard/vendas',
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

        <button
          type="button"
          onClick={() => setCurrentSubPage('perfil')}
          className="mt-4 flex w-full items-center gap-4 rounded-xl bg-[#0E1110] p-4 text-left transition-all duration-200 active:scale-[0.99]"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#131C18] text-sm font-bold text-[#1DB854]">
            {avatarUrl ? <img src={avatarUrl} alt="Avatar do usuário" className="h-full w-full object-cover" onError={() => setAvatarUrl('')} /> : initials(name)}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-bold text-white">Meu Perfil</strong>
            <span className="mt-0.5 block truncate text-xs text-zinc-400">{name || 'Conta autenticada'}</span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">{email || 'E-mail de acesso'}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-zinc-600" />
        </button>

        <section className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => openItem(item)}
                className="flex w-full items-center justify-between gap-4 rounded-xl bg-[#0E1110] p-4 text-left transition-all duration-200 active:scale-[0.99]"
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

        {notice && <div className="mt-2 bg-transparent py-2 text-[10px] text-zinc-500" role="status">{notice}</div>}
      </>
    )
  }

  const subPage = currentSubPage !== 'menu'

  return (
    <section className="relative min-h-[500px] space-y-5 pb-32 font-['Space_Grotesk'] text-white" aria-label="Configurações mobile">
      <button
        type="button"
        onClick={() => void logout()}
        className="absolute right-0 top-0 z-50 flex items-center gap-1 bg-transparent px-4 py-2 text-xs font-bold text-red-400 transition-all duration-200 active:scale-95 hover:text-red-300"
      >
        <LogOut size={15} strokeWidth={2.5} />
        <span>Sair</span>
      </button>

      {subPage && (
        <button type="button" onClick={() => setCurrentSubPage('menu')} className="pr-24 text-xs font-bold text-zinc-500 transition hover:text-white">
          ← Voltar
        </button>
      )}

      <div className={subPage ? 'pr-24' : ''}>{pageContent()}</div>
    </section>
  )
}
