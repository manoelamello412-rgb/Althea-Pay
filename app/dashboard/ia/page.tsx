'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'
import IaraCopilot from '@/components/iara-copilot'

const tabs: MobileShellTab[] = ['dashboard', 'gateways', 'funis', 'ia', 'configuracoes']

export default function IaraDashboardRoute() {
  const [activeTab, setActiveTab] = useState<MobileShellTab>('ia')

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

  const screens: Record<MobileShellTab, ReactNode> = {
    dashboard: <div />,
    gateways: <div />,
    funis: <div />,
    ia: <IaraCopilot />,
    configuracoes: <div />,
  }

  return <MobileShell activeTab={activeTab} onTabChange={selectTab}>{screens[activeTab]}</MobileShell>
}
