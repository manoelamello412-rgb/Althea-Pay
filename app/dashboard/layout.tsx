'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'

const routes: Record<MobileShellTab, string> = {
  dashboard: '/dashboard',
  gateways: '/dashboard/gateways',
  chat: '/dashboard/crm',
  ia: '/dashboard/ia',
  funil: '/dashboard/funil',
}

function tabFromPath(pathname: string): MobileShellTab {
  if (pathname.startsWith('/dashboard/gateways')) return 'gateways'
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
      <div className="althea-page-content">
        {children}
      </div>
      <style jsx global>{`
        .althea-page-content {
          background: var(--althea-bg, #0B0B0D) !important;
        }

        /* The Dashboard is the single visual source of truth for the page
           canvas. Only legacy page roots are normalized here; cards, panels,
           inputs and other nested surfaces retain their intended palette. */
        .althea-page-content > div.min-h-screen {
          background: var(--althea-bg, #0B0B0D) !important;
        }

        .althea-page-content .al-chat-top,
        .althea-page-content .al-bottom-nav,
        .althea-page-content .althea-legacy-bottom-nav {
          display: none !important;
        }

        /* Legacy dashboard pages may still render their own shell while being
           migrated. Keep the dashboard layout as the single visual shell. */
        .althea-page-content > div.min-h-screen > header {
          display: none !important;
        }

        .althea-page-content > div.min-h-screen > main.max-w-md,
        .althea-page-content > div.min-h-screen > main[class*="max-w-md"] {
          width: 100% !important;
          max-width: min(1440px, calc(100vw - 32px)) !important;
          margin-left: auto !important;
          margin-right: auto !important;
        }
      `}</style>
    </MobileShell>
  )
}