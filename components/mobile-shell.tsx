'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, CreditCard, MessageSquare, Settings, WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'

export type MobileShellTab = 'dashboard' | 'vendas' | 'funis' | 'gateways' | 'configuracoes'

const tabs: Array<{ id: MobileShellTab; label: string; icon: typeof BarChart3 }> = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'vendas', label: 'Vendas', icon: CreditCard },
  { id: 'funis', label: 'Chat & Funis', icon: MessageSquare },
  { id: 'gateways', label: 'Gateways', icon: WalletCards },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
]

type Props = {
  activeTab: MobileShellTab
  onTabChange: (tab: MobileShellTab) => void
  children: ReactNode
}

export default function MobileShell({ activeTab, onTabChange, children }: Props) {
  return (
    <div className="althea-shell">
      <aside className="althea-glass-sidebar" aria-label="Navegação principal">
        <button className="althea-shell-brand" type="button" aria-label="Voltar ao Dashboard" onClick={() => onTabChange('dashboard')}>
          <img src="/althea-logo.png" alt="ALTHEA PAY" />
        </button>
        <div className="althea-sidebar-nav">
          {tabs.map(({ id, label, icon: Icon }) => (
            <ShellNavButton key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} />
          ))}
        </div>
      </aside>

      <main className="althea-shell-main">
        <div className="althea-bento-stage">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              className="althea-screen-transition"
              initial={{ opacity: 0, x: 18, scale: 0.985, filter: 'blur(4px)' }}
              animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: -18, scale: 0.985, filter: 'blur(4px)' }}
              transition={{ type: 'spring', stiffness: 360, damping: 30, mass: 0.72 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <nav className="althea-mobile-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, icon: Icon }) => (
          <ShellNavButton key={id} id={id} label={label} icon={Icon} active={activeTab === id} onClick={onTabChange} mobile />
        ))}
      </nav>
    </div>
  )
}

function ShellNavButton({ id, label, icon: Icon, active, onClick, mobile = false }: { id: MobileShellTab; label: string; icon: typeof BarChart3; active: boolean; onClick: (tab: MobileShellTab) => void; mobile?: boolean }) {
  return (
    <motion.button
      type="button"
      className={`althea-shell-nav-button${active ? ' active' : ''}${mobile ? ' mobile' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={() => onClick(id)}
      whileHover={{ x: mobile ? 0 : 3, scale: 1.035 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 520, damping: 24, mass: 0.55 }}
    >
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </motion.button>
  )
}
