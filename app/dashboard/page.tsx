'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'
import DashboardMobile from '@/components/dashboard-control'

const routes: Record<MobileShellTab, string> = {
  dashboard: '/dashboard',
  gateways: '/dashboard/gateways',
  chat: '/dashboard/crm',
  ia: '/dashboard/ia',
  funil: '/dashboard/funil',
}

export default function MobileDashboardOrchestrator() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<MobileShellTab>('dashboard')

  const selectTab = useCallback((tab: MobileShellTab) => {
    setActiveTab(tab)
    if (routes[tab] !== '/dashboard') router.push(routes[tab])
  }, [router])

  useEffect(() => {
    const handler = (event: Event) => {
      const value = (event as CustomEvent<string>).detail as MobileShellTab
      if (value in routes) setActiveTab(value)
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

  return <MobileShell activeTab={activeTab} onTabChange={selectTab}><DashboardMobile /></MobileShell>
}
