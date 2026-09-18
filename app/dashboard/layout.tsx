'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'

const routes: Record<MobileShellTab, string> = {
  dashboard: '/dashboard',
  vendas: '/dashboard/vendas',
  chat: '/dashboard/crm',
  ia: '/dashboard/ia',
  funil: '/dashboard/funil',
}

function tabFromPath(pathname: string): MobileShellTab {
  if (pathname.startsWith('/dashboard/vendas')) return 'vendas'
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
    if (route !== pathname) router.push(route)
  }, [pathname, router])

  return (
    <MobileShell activeTab={activeTab} onTabChange={selectTab}>
      <div className="althea-page-content font-['Space_Grotesk'] text-[var(--althea-white)]">
        {children}
      </div>
    </MobileShell>
  )
}
