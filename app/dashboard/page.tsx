'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'
import DashboardMobile from '@/components/dashboard-control'
import FunnelsMobile from '@/components/funnels-mobile'
import GatewaysMobile from '@/components/gateways-mobile'
import SettingsMobile from '@/components/settings-mobile'

const tabs: MobileShellTab[] = ['dashboard', 'gateways', 'funis', 'ia', 'configuracoes']

function IAVIsual() {
  return (
    <section className="althea-mobile-ia" aria-labelledby="ia-title">
      <div className="althea-ia-card">
        <div className="althea-ia-icon" aria-hidden="true">✦</div>
        <div>
          <h1 id="ia-title">IA</h1>
          <p>Inteligência e automações da sua operação.</p>
        </div>
      </div>
    </section>
  )
}

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

  const screens: Record<MobileShellTab, ReactNode> = {
    dashboard: <DashboardMobile />,
    gateways: <GatewaysMobile />,
    funis: <FunnelsMobile />,
    ia: <IAVIsual />,
    configuracoes: <SettingsMobile />,
  }

  return <MobileShell activeTab={activeTab} onTabChange={selectTab}>{screens[activeTab]}</MobileShell>
}
