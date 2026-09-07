'use client'

import { ChevronRight, CircleDollarSign, FileText, LogOut, ShieldCheck, UserRound, Building2, RefreshCcw, PlugZap } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import PerfilSettingsPage from '@/app/dashboard/settings/perfil/page'
import EmpresaSettingsPage from '@/app/dashboard/settings/empresa/page'
import IntegracoesSettingsPage from '@/app/dashboard/settings/integracoes/page'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type SubPage = 'menu' | 'perfil' | 'empresa' | 'integracoes'

const items = [
  ['Minha Empresa', Building2, 'Dados jurídicos, fiscais e cadastrais da operação', 'empresa'],
  ['Integrações', PlugZap, 'API, tokens e webhooks para sistemas externos', 'integracoes'],
  ['Recuperação', RefreshCcw, 'Réguas para carrinhos, PIX expirado e boleto sem pagamento', 'recuperacao'],
  ['Financeiro', CircleDollarSign, 'Moeda, taxas e preferências financeiras', 'none'],
  ['Checkout & Domínios', FileText, 'Checkout e domínios da operação', 'none'],
  ['Segurança & Auditoria', ShieldCheck, 'Acesso, segurança e auditoria', 'none'],
] as const

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

  useEffect(() => {
    const handler = () => setCurrentSubPage('menu')
    window.addEventListener('althea-settings-back', handler)
    return () => window.removeEventListener('althea-settings-back', handler)
  }, [])

  async function logout() {
    setNotice('Encerrando sessão…')
    const { error } = await db.auth.signOut()
    if (error) { setNotice(error.message); return }
    router.replace('/login')
  }

  function pageContent(): ReactNode {
    if (currentSubPage === 'perfil') return <PerfilSettingsPage />
    if (currentSubPage === 'empresa') return <EmpresaSettingsPage />
    if (currentSubPage === 'integracoes') return <IntegracoesSettingsPage />

    return (
      <>
        <header className="pr-24">
          <h1 className="text-2xl font-black tracking-tight text-white">Configurações</h1>
          <p className="mt-1 text-xs font-medium text-zinc-500">Gerencie as diretrizes gerais da sua operação</p>
        </header>

        <button
          type="button"
          onClick={() => setCurrentSubPage('perfil')}
          className="flex w-full items-center gap-4 bg-transparent py-4 text-left transition-all duration-200 active:scale-[0.99]"
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

        <section className="flex flex-col gap-1 pt-2">
          {items.map(([label, Icon, desc, target]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (target === 'empresa') setCurrentSubPage('empresa')
                else if (target === 'integracoes') setCurrentSubPage('integracoes')
                else if (target === 'recuperacao') window.location.assign('/dashboard/settings/recuperacao')
                else setNotice(`${label}: área preparada para configuração.`)
              }}
              className="flex w-full items-center justify-between gap-4 bg-transparent py-4 text-left transition-all duration-200 active:scale-[0.99]"
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#111312] text-zinc-500"><Icon size={18} strokeWidth={1.8} /></span>
                <span className="min-w-0">
                  <strong className="block text-sm font-bold text-white">{label}</strong>
                  <small className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">{desc}</small>
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-zinc-600" />
            </button>
          ))}
        </section>

        {notice && <div className="mt-2 bg-transparent py-3 text-[10px] text-zinc-500" role="status">{notice}</div>}
      </>
    )
  }

  const subPage = currentSubPage !== 'menu'

  return (
    <section className="relative min-h-[500px] space-y-5 pb-32 font-['Space_Grotesk'] text-white" aria-label="Configurações mobile">
      <button
        type="button"
        onClick={() => void logout()}
        className="absolute right-0 top-0 z-50 flex items-center gap-1 bg-transparent py-2 text-xs font-bold text-red-400 transition-all duration-200 active:scale-95 hover:text-red-300"
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
