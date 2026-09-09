'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { GitBranch, LayoutDashboard, MessageCircle, Network, Search, Settings, Sparkles, X } from 'lucide-react'
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
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setSearchOpen(false)
    setQuery('')
  }, [activeTab])

  const openSettings = () => router.push('/dashboard/settings')

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

      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#070908]/95 px-4 py-3 backdrop-blur-xl lg:ml-[250px]">
        <div className="mx-auto flex min-h-10 w-full max-w-xl items-center justify-between gap-3 lg:max-w-none">
          <button type="button" onClick={() => onTabChange('dashboard')} aria-label="Voltar ao Dashboard" className="flex min-w-0 items-center">
            <img src="/althea-logo-inner.PNG" alt="ALTHEA PAY" className="h-7 w-auto max-w-[132px] object-contain" />
          </button>

          <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
            <span className="hidden truncate pr-1 text-right text-[11px] font-semibold tracking-[0.12em] text-[#d1d8d4] sm:block">
              // {titles[activeTab]}
            </span>
            <button
              type="button"
              aria-label="Pesquisar"
              onClick={() => setSearchOpen((value) => !value)}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition ${searchOpen ? 'border-[#1DB854]/50 bg-[#0d1a13] text-[#1DB854]' : 'border-white/[0.06] bg-transparent text-[#a8b0ac] hover:text-white'}`}
            >
              <Search size={17} />
            </button>
            <button
              type="button"
              aria-label="Configurações"
              title="Configurações"
              onClick={openSettings}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.06] bg-transparent text-[#a8b0ac] transition hover:border-[#1DB854]/40 hover:bg-[#0d1a13] hover:text-[#1DB854]"
            >
              <Settings size={17} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 42 }} exit={{ opacity: 0, height: 0 }} className="mx-auto mt-3 flex max-w-xl items-center gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0d0c] px-3 lg:max-w-none">
              <Search size={15} className="text-[#66716c]" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#66716c]" />
              <button type="button" aria-label="Fechar pesquisa" onClick={() => { setQuery(''); setSearchOpen(false) }} className="text-[#737d79]"><X size={15} /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="lg:ml-[250px] pb-28 lg:pb-8">
        <div className="mx-auto w-full max-w-xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 lg:left-[250px]" aria-label="Navegação principal">
        <div className="mx-auto flex h-[72px] w-full max-w-xl items-center justify-between gap-1 rounded-[38px] border border-white/[0.12] bg-[#090b0a]/96 px-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.62)] backdrop-blur-2xl">
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
    <motion.button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={() => onClick(id)}
      whileTap={{ scale: 0.96 }}
      className={`group relative flex items-center justify-center rounded-[32px] transition-all duration-200 ${mobile ? 'h-[66px] min-w-0 flex-1 flex-col gap-1 px-1.5 py-2' : 'w-full justify-start gap-2 px-3 py-3'} ${active ? 'text-[#e9fff0]' : 'text-[#777f7b] hover:text-white'}`}
    >
      {active && (
        <span className={`absolute rounded-[30px] border border-[#1DB854]/25 bg-[#0b2418] shadow-[inset_0_0_24px_rgba(29,184,84,0.06)] ${mobile ? 'inset-y-0 inset-x-0' : 'inset-y-2 left-0 w-[2px] rounded-full border-0 bg-[#1DB854]'}`} />
      )}
      <Icon className="relative z-10" size={mobile ? 28 : 19} strokeWidth={active ? 2.05 : 1.8} />
      <span className={`relative z-10 ${mobile ? 'text-[11px] font-medium leading-none' : 'text-xs'}`}>{label}</span>
    </motion.button>
  )
}
