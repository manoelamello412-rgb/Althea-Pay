'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { LayoutDashboard, MessageCircle, Network, RefreshCw, Search, Settings, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'gateways' | 'funis' | 'ia' | 'configuracoes'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'gateways', label: 'Gateway', icon: Network },
  { id: 'funis', label: 'Chat', icon: MessageCircle },
  { id: 'ia', label: 'IA', icon: Sparkles },
  { id: 'configuracoes', label: 'Configuração', icon: Settings },
] as const

const pageTitles: Record<MobileShellTab, string> = {
  dashboard: 'Dashboard',
  gateways: 'Gateway',
  funis: 'Chat',
  ia: 'IA',
  configuracoes: 'Configuração',
}

type Props = { activeTab: MobileShellTab; onTabChange: (tab: MobileShellTab) => void; children: ReactNode }

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('althea-global-search', { detail: { query: query.trim() } }))
    }, 180)
    return () => window.clearTimeout(id)
  }, [query])

  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)
  }

  return (
    <div className="althea-shell min-h-screen">
      <aside className="althea-glass-sidebar">
        <button className="althea-shell-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}>
          <img src="/althea-logo-inner.png" alt="ALTHEA PAY" />
        </button>
        <div className="althea-sidebar-nav">
          {tabs.map(({ id, label, icon: Icon }) => <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} />)}
        </div>
      </aside>

      <header className="althea-mobile-global-header">
        <div className="althea-mobile-global-topline">
          <button className="althea-mobile-global-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}>
            <img src="/althea-logo-inner.png" alt="ALTHEA PAY" />
          </button>
          <strong className="althea-mobile-global-title">{pageTitles[activeTab]}</strong>
          <div className="althea-mobile-global-actions">
            <motion.button type="button" aria-label="Pesquisar" className="althea-mobile-global-icon" onClick={() => setSearchOpen((value) => !value)} whileTap={{ scale: .92 }}>
              <Search size={18} />
            </motion.button>
            <motion.button type="button" aria-label="Atualizar" className="althea-mobile-global-icon" onClick={() => window.dispatchEvent(new CustomEvent('althea-refresh'))} whileTap={{ scale: .92 }}>
              <RefreshCw size={17} />
            </motion.button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div className="althea-mobile-global-search-wrap" initial={{ opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: 40, y: 0 }} exit={{ opacity: 0, height: 0, y: -4 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
              <Search size={15} aria-hidden="true" />
              <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar..." aria-label="Pesquisar na ALTHEA PAY" />
              <button type="button" className="althea-mobile-global-search-close" onClick={closeSearch} aria-label="Fechar pesquisa"><X size={15} /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="althea-shell-main pb-32 md:pb-8">
        <div className="althea-bento-stage">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTab} className="althea-screen-transition" initial={{ opacity: 0, x: 18, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -18, scale: .985 }} transition={{ type: 'spring', stiffness: 360, damping: 30, mass: .72 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <nav className="althea-mobile-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, icon: Icon }) => <Nav key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} mobile />)}
      </nav>
    </div>
  )
}

function Nav({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof LayoutDashboard; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return (
    <motion.button type="button" className={`althea-shell-nav-button${active ? ' active' : ''}${mobile ? ' mobile' : ''}`} aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileHover={{ x: mobile ? 0 : 3, scale: 1.035 }} whileTap={{ scale: .94 }} transition={{ type: 'spring', stiffness: 520, damping: 24, mass: .55 }}>
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </motion.button>
  )
}
