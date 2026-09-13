'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'

const routes: Record<MobileShellTab, string> = {
  dashboard: '/dashboard',
  vendas: '/dashboard',
  chat: '/dashboard/crm',
  ia: '/dashboard/ia',
  funil: '/dashboard/funil',
}

function tabFromPath(pathname: string): MobileShellTab {
  if (pathname.startsWith('/dashboard/crm')) return 'chat'
  if (pathname.startsWith('/dashboard/ia')) return 'ia'
  if (pathname.startsWith('/dashboard/funil')) return 'funil'
  return 'dashboard'
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const activeTab = tabFromPath(pathname)

  const selectTab = useCallback((tab: MobileShellTab) => {
    const route = routes[tab]
    if (tab === 'vendas') {
      window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: 'vendas' }))
      if (pathname !== '/dashboard') router.push('/dashboard')
      return
    }
    if (route !== pathname) router.push(route)
  }, [pathname, router])

  return (
    <MobileShell activeTab={activeTab} onTabChange={selectTab}>
      <div className="althea-page-content">
        {children}
      </div>
      <style jsx global>{`
        .althea-page-content .al-chat-top,
        .althea-page-content .al-bottom-nav,
        .althea-page-content .althea-legacy-bottom-nav,
        .althea-page-content > div > header {
          display: none !important;
        }
      `}</style>
    </MobileShell>
  )
}
