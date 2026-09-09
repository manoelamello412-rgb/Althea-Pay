'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'
import IaraCopilot from '@/components/iara-copilot'

const routes: Record<MobileShellTab, string> = {
  dashboard: '/dashboard',
  gateways: '/dashboard/gateways',
  funis: '/dashboard/crm',
  ia: '/dashboard/ia',
  configuracoes: '/dashboard/settings',
}

export default function IaraDashboardRoute() {
  const router = useRouter()

  const selectTab = useCallback((tab: MobileShellTab) => {
    router.push(routes[tab])
  }, [router])

  return (
    <MobileShell activeTab="ia" onTabChange={selectTab}>
      <IaraCopilot />
    </MobileShell>
  )
}
