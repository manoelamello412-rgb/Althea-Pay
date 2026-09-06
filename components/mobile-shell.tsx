'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, CreditCard, MessageSquare, RefreshCw, Search, Settings, WalletCards, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'vendas' | 'funis' | 'gateways' | 'configuracoes'
const tabs: Array<{ id: MobileShellTab; label: string; icon: typeof BarChart3 }> = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'vendas', label: 'Vendas', icon: CreditCard },
  { id: 'funis', label: 'Chat & Funis', icon: MessageSquare },
  { id: 'gateways', label: 'Gateway', icon: WalletCards },
  { id: 'configuracoes', label: 'Configuração', icon: Settings },
]
type Props = { activeTab: MobileShellTab; onTabChange: (tab: MobileShellTab) => void; children: ReactNode }

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? 'Dashboard'
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const refreshCurrentScreen = () => window.dispatchEvent(new CustomEvent('althea-refresh'))
  const search = (value: string) => { setQuery(value); window.dispatchEvent(new CustomEvent('althea-global-search', { detail: value })) }
  const closeSearch = () => { search(''); setSearchOpen(false) }

  return <div className="althea-shell min-h-screen">
    <aside className="althea-glass-sidebar">
      <button className="althea-shell-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}><img src="/althea-logo.png" alt="ALTHEA PAY" /></button>
      <div className="althea-sidebar-nav">{tabs.map(({ id, label, icon: Icon }) => <ShellNavButton key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} />)}</div>
    </aside>

    <header className="althea-mobile-global-header">
      <button className="althea-mobile-global-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}><img src="/althea-logo.png" alt="ALTHEA PAY" /></button>
      <AnimatePresence mode="wait" initial={false}>
        {searchOpen ? <motion.label key="search" className="althea-mobile-global-search-wrap" initial={{ opacity: 0, scaleX: .88, x: 8 }} animate={{ opacity: 1, scaleX: 1, x: 0 }} exit={{ opacity: 0, scaleX: .88, x: 8 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
          <Search size={17} aria-hidden="true" /><input autoFocus type="search" value={query} onChange={(e) => search(e.target.value)} placeholder="Buscar na ALTHEA PAY..." aria-label="Buscar na ALTHEA PAY" /><button type="button" className="althea-mobile-global-search-close" aria-label="Fechar busca" onClick={closeSearch}><X size={17} aria-hidden="true" /></button>
        </motion.label> : <motion.div key="title" className="althea-mobile-global-title" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}><strong>ALTHEA PAY</strong><span>{activeLabel.toUpperCase()}</span></motion.div>}
      </AnimatePresence>
      <div className="althea-mobile-global-actions">
        <motion.button type="button" aria-label="Buscar" className="althea-mobile-global-search" onClick={() => setSearchOpen(true)} whileTap={{ scale: .9 }}><Search size={18} aria-hidden="true" /></motion.button>
        {!searchOpen && <motion.button type="button" aria-label="Atualizar tela" className="althea-mobile-global-refresh" onClick={refreshCurrentScreen} whileTap={{ scale: .9 }}><RefreshCw size={18} aria-hidden="true" /></motion.button>}
      </div>
    </header>

    <main className="althea-shell-main pb-32 md:pb-8"><div className="althea-bento-stage"><AnimatePresence mode="wait" initial={false}><motion.div key={activeTab} className="althea-screen-transition will-change-transform transform-gpu" style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }} initial={{ opacity: 0, x: 18, scale: .985, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, x: -18, scale: .985, filter: 'blur(4px)' }} transition={{ type: 'spring', stiffness: 360, damping: 30, mass: .72 }}>{children}</motion.div></AnimatePresence></div></main>
    <nav className="althea-mobile-nav transform-gpu will-change-transform" style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }} aria-label="Navegação principal">{tabs.map(({ id, label, icon: Icon }) => <ShellNavButton key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} mobile />)}</nav>
  </div>
}

function ShellNavButton({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof BarChart3; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return <motion.button type="button" className={`althea-shell-nav-button${active ? ' active' : ''}${mobile ? ' mobile' : ''} transform-gpu will-change-transform`} aria-current={active ? 'page' : undefined} aria-label={label} onClick={() => onClick(id)} whileHover={{ x: mobile ? 0 : 3, scale: 1.035 }} whileTap={{ scale: .94 }} transition={{ type: 'spring', stiffness: 520, damping: 24, mass: .55 }}><Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></motion.button>
}
