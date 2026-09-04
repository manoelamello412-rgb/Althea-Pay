'use client'

import { useCallback, useEffect, useState } from 'react'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'
import DashboardMobile from '@/components/dashboard-control'
import SalesMobile from '@/components/sales-mobile'
import FunnelsMobile from '@/components/funnels-mobile'
import GatewaysMobile from '@/components/gateways-mobile'
import SettingsMobile from '@/components/settings-mobile'

const tabs: MobileShellTab[] = ['dashboard', 'vendas', 'funis', 'gateways', 'configuracoes']

export default function MobileDashboardOrchestrator() {
  const [activeTab, setActiveTab] = useState<MobileShellTab>('dashboard')

  const selectTab = useCallback((tab: MobileShellTab) => {
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: tab }))
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const value = (event as CustomEvent<string>).detail
      if (tabs.includes(value as MobileShellTab)) setActiveTab(value as MobileShellTab)
    }
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--althea-ink', '#0B0B0D')
    root.style.setProperty('--althea-forest', '#0F1A16')
    root.style.setProperty('--althea-deep', '#0D362D')
    root.style.setProperty('--althea-green', '#1DB854')
    root.style.setProperty('--althea-gold', '#D4AF37')
    root.style.setProperty('--althea-silver', '#A6A6A6')
  }, [])

  const screens: Record<MobileShellTab, React.ReactNode> = {
    dashboard: <DashboardMobile />,
    vendas: <SalesMobile />,
    funis: <FunnelsMobile />,
    gateways: <GatewaysMobile />,
    configuracoes: <SettingsMobile />,
  }

  return <MobileShell activeTab={activeTab} onTabChange={selectTab}>{screens[activeTab]}</MobileShell>
}
