'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Building2, FileKey2, GitBranch, Globe2, LayoutDashboard, MessageCircle, Network, Search, Settings, ShieldCheck, Sparkles, UserRound, Users, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'gateways' | 'chat' | 'ia' | 'funil'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gateways', label: 'Gateway', icon: Network },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'ia', label: 'IA', icon: Sparkles },
  { id: 'funil', label: 'Funil', icon: GitBranch },
] as const

const settingsItems = [
  { label: 'Meu Perfil', href: '/dashboard/settings/perfil', icon: UserRound },
  { label: 'Minha Empresa', href: '/dashboard/settings/empresa', icon: Building2 },
  { label: 'Segurança', href: '/dashboard/settings/seguranca', icon: ShieldCheck },
  { label: 'Desempenho', href: '/dashboard/settings/desempenho', icon: Sparkles },
  { label: 'Vendas', href: '/dashboard/settings/vendas', icon: Network },
  { label: 'Funil e Domínio', href: '/dashboard/settings/funil-dominio', icon: Globe2 },
  { label: 'Recuperação', href: '/dashboard/settings/recuperacao', icon: MessageCircle },
  { label: 'Usuários', href: '/dashboard/settings/usuarios', icon: Users },
  { label: 'Integrações', href: '/dashboard/settings/integracoes', icon: FileKey2 },
  { label: 'IARA', href: '/dashboard/settings/iara', icon: Sparkles },
  { label: 'Gateways', href: '/dashboard/settings/gateways', icon: Network },
] as const

const titles: Record<MobileShellTab, string> = {
  dashboard: 'DASHBOARD',
  gateways: 'GATEWAY',
  chat: 'CHAT',
  ia: 'IA',
  funil: 'FUNIL',
}

type Props = {
  activeTab: MobileShellTab
  onTabChange: (tab: MobileShellTab) => void
  children: ReactNode
}

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setSearchOpen(false)
    setSettingsOpen(false)
    setQuery('')
  }, [activeTab])

  return (
    <div className="min-h-screen bg-[#020203] text-white antialiased">
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[250px] border-r border-white/[0.07] bg-[#070908] px-4 py-6 lg:flex lg:flex-col">
        <button type="button" onClick={() => onTabChange('dashboard')} className="mb-8 flex items-center justify-center rounded-2xl border border-white/[0.06] bg-[#0a0d0b] p-4">
          <img src="/althea-logo-inner.PNG" alt="ALTHEA PAY" className="h-12 w-auto object-contain" />
        </button>
        <div className="space-y-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} />
          ))}
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#020203]/98 px-4 backdrop-blur-xl lg:ml-[250px]">
        <div className="mx-auto flex h-[140px] w-full max-w-[1106px] items-center gap-0">
          <button type="button" onClick={() => onTabChange('dashboard')} aria-label="Voltar ao Dashboard" className="flex shrink-0 items-center">
            <img src="/althea-logo-inner.PNG" alt="ALTHEA PAY" className="h-[58px] w-[92px] object-contain object-left" />
          </button>

          <div className="mx-5 h-[48px] w-px shrink-0 bg-white/[0.14]" aria-hidden="true" />

          <h1 className="min-w-0 truncate text-[27px] font-semibold tracking-[-0.025em] text-[#f4f5f4] sm:text-[30px]">
            ALTHEA PAY <span className="text-[#6f7471]">//</span> {titles[activeTab]}
          </h1>

          <div className="ml-auto flex shrink-0 items-center gap-8 pl-5">
            <button type="button" aria-label="Pesquisar" onClick={() => setSearchOpen((value) => !value)} className={`grid h-12 w-12 place-items-center rounded-full transition ${searchOpen ? 'text-[#1DB854]' : 'text-[#a8a8b5] hover:text-white'}`}>
              <Search size={38} strokeWidth={1.65} />
            </button>
            <div className="relative">
              <button type="button" aria-label="Configurações" title="Configurações" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)} className={`grid h-12 w-12 place-items-center rounded-full transition ${settingsOpen ? 'text-[#1DB854]' : 'text-[#a8a8b5] hover:text-white'}`}>
                <Settings size={38} strokeWidth={1.65} />
              </button>
              <AnimatePresence>
                {settingsOpen && (
                  <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} className="absolute right-0 top-14 z-[70] w-[300px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0f0d]/98 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
                    <button type="button" onClick={() => { setSettingsOpen(false); router.push('/dashboard/settings') }} className="mb-1 flex w-full items-center gap-3 rounded-xl border border-[#1DB854]/20 bg-[#0b2418] px-3 py-3 text-left">
                      <Settings size={17} className="text-[#1DB854]" />
                      <span><strong className="block text-sm text-white">Central de Configuração</strong><small className="text-[10px] text-[#8d9992]">Abrir visão geral das configurações</small></span>
                    </button>
                    <div className="max-h-[min(520px,calc(100vh-170px))] overflow-y-auto pr-1">
                      {settingsItems.map(({ label, href, icon: Icon }) => (
                        <button key={href} type="button" onClick={() => { setSettingsOpen(false); router.push(href) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#a8b0ac] transition hover:bg-white/[0.04] hover:text-white">
                          <Icon size={16} strokeWidth={1.8} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 42 }} exit={{ opacity: 0, height: 0 }} className="mx-auto mb-3 flex max-w-[1106px] items-center gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0d0c] px-3">
              <Search size={15} className="text-[#66716c]" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#66716c]" />
              <button type="button" aria-label="Fechar pesquisa" onClick={() => { setQuery(''); setSearchOpen(false) }} className="text-[#737d79]"><X size={15} /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="lg:ml-[250px] pb-28 lg:pb-8">
        <div className="mx-auto w-full max-w-[1180px] px-3 sm:px-5 lg:px-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:left-[250px]" aria-label="Navegação principal">
        <div className="mx-auto flex h-[72px] w-full max-w-[1106px] items-center justify-between gap-1 rounded-[38px] border border-white/[0.12] bg-[#090b0a]/96 px-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.62)] backdrop-blur-2xl">
          {tabs.map(({ id, label, icon: Icon }) => (
            <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} mobile />
          ))}
        </div>
      </nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: {
  id: MobileShellTab
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  onClick: (tab: MobileShellTab) => void
  mobile?: boolean
}) {
  return (
    <motion.button type="button" aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileTap={{ scale: 0.96 }} className={`group relative flex items-center justify-center rounded-[32px] transition-all duration-200 ${mobile ? 'h-[66px] min-w-0 flex-1 flex-col gap-1 px-1.5 py-2' : 'w-full justify-start gap-2 px-3 py-3'} ${active ? 'text-[#e9fff0]' : 'text-[#777f7b] hover:text-white'}`}>
      {active && <span className={`absolute rounded-[30px] border border-[#1DB854]/25 bg-[#0b2418] shadow-[inset_0_0_24px_rgba(29,184,84,0.06)] ${mobile ? 'inset-y-0 inset-x-0' : 'inset-y-2 left-0 w-[2px] rounded-full border-0 bg-[#1DB854]'}`} />}
      <Icon className="relative z-10" size={mobile ? 28 : 19} strokeWidth={active ? 2.05 : 1.8} />
      <span className={`relative z-10 ${mobile ? 'text-[11px] font-medium leading-none' : 'text-xs'}`}>{label}</span>
    </motion.button>
  )
}
