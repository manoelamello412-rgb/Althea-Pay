'use client'

import React, { useEffect, useState } from 'react'
import { BarChart3, CreditCard, MessageSquare, Settings, WalletCards, MoreVertical } from 'lucide-react'
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

export default function MobileDashboardOrchestrator() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('dashboard')
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

  const selectTab = (tab: (typeof tabs)[number]['id']) => {
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: tab }))
  }

  return (
    <div className="althea-dashboard-orchestrator">
      <header className="ado-header">
        <button type="button" className="ado-brand" aria-label="Voltar ao Dashboard" onClick={() => selectTab('dashboard')}>
          <img src={logo} alt="ALTHEA PAY" />
        </button>
        <button type="button" className="ado-menu" aria-label="Opções">
          <MoreVertical size={19} />
        </button>
      </header>

      <main className="ado-content">
        <div className={activeTab === 'dashboard' ? 'ado-panel active' : 'ado-panel'}><DashboardMobile /></div>
        <div className={activeTab === 'vendas' ? 'ado-panel active' : 'ado-panel'}><SalesMobile /></div>
        <div className={activeTab === 'chat' ? 'ado-panel active' : 'ado-panel'}><FunnelsMobile /></div>
        <div className={activeTab === 'gateways' ? 'ado-panel active' : 'ado-panel'}><GatewaysMobile /></div>
        <div className={activeTab === 'config' ? 'ado-panel active' : 'ado-panel'}><SettingsMobile /></div>
      </main>

      <nav className="ado-bottom-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => selectTab(id)}>
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
