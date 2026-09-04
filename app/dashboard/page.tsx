'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, CreditCard, MessageSquare, Settings, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import MotionButton from '@/components/motion-button'
import DashboardMobile from '@/components/dashboard-control'
import SalesMobile from '@/components/sales-mobile'
import FunnelsMobile from '@/components/ChatOmnichannel'
import GatewaysMobile from '@/components/GatewaysControl'
import SettingsMobile from '@/components/SettingsControl'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'vendas', label: 'Vendas', icon: CreditCard },
  { id: 'chat', label: 'Chat & Funis', icon: MessageSquare },
  { id: 'gateways', label: 'Gateway', icon: WalletCards },
  { id: 'config', label: 'Configuração', icon: Settings },
] as const

type TabId = (typeof tabs)[number]['id']

const panels: Record<TabId, React.ComponentType> = {
  dashboard: DashboardMobile,
  vendas: SalesMobile,
  chat: FunnelsMobile,
  gateways: GatewaysMobile,
  config: SettingsMobile,
}

export default function MobileDashboardOrchestrator() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [logo, setLogo] = useState('/althea-logo.png')

  useEffect(() => {
    const syncBrand = () => {
      const root = document.documentElement
      root.style.setProperty('--althea-ink', '#0B0B0D')
      root.style.setProperty('--althea-forest', '#0F1A16')
      root.style.setProperty('--althea-deep', '#0D362D')
      root.style.setProperty('--althea-green', '#1DB854')
      root.style.setProperty('--althea-gold', '#D4AF37')
      root.style.setProperty('--althea-silver', '#A6A6A6')
      setLogo('/althea-logo.png')
    }
    syncBrand()
    window.addEventListener('althea-brand-updated', syncBrand)
    return () => window.removeEventListener('althea-brand-updated', syncBrand)
  }, [])

  const selectTab = (tab: TabId) => {
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: tab }))
  }

  const ActivePanel = panels[activeTab]

  return (
    <div className="althea-dashboard-orchestrator">
      <header className="ado-header">
        <MotionButton
          type="button"
          className="ado-brand"
          aria-label="Voltar ao Dashboard"
          onClick={() => selectTab('dashboard')}
          glow
        >
          <img src={logo} alt="ALTHEA PAY" />
        </MotionButton>
      </header>

      <main className="ado-content" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            className="ado-panel active"
            initial={{ opacity: 0, x: 18, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -12, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30, mass: 0.75 }}
          >
            <ActivePanel />
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="ado-bottom-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <MotionButton
              key={id}
              type="button"
              className={active ? 'active' : ''}
              aria-current={active ? 'page' : undefined}
              onClick={() => selectTab(id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </MotionButton>
          )
        })}
      </nav>
    </div>
  )
}
