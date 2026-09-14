'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'

const routes: Record<MobileShellTab, string> = {
  dashboard: '/dashboard',
  gateway: '/dashboard/gateways',
  chat: '/dashboard/crm',
  ia: '/dashboard/ia',
  funil: '/dashboard/funil',
}

function tabFromPath(pathname: string): MobileShellTab {
  if (pathname.startsWith('/dashboard/gateways')) return 'gateway'
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
          font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
          color: var(--althea-white);
        }
        .althea-page-content .al-chat-top,
        .althea-page-content .al-bottom-nav,
        .althea-page-content .althea-legacy-bottom-nav,
        .althea-page-content .ams-header,
        .althea-page-content .ams-bottom-nav,
        .althea-page-content > div > header,
        .althea-page-content > main > header {
          display: none !important;
        }
        .althea-page-content > div.min-h-screen,
        .althea-page-content > main.min-h-screen {
          min-height: calc(100dvh - 82px) !important;
          background: var(--althea-bg) !important;
          color: var(--althea-white) !important;
        }
        .althea-page-content > div.min-h-screen > main,
        .althea-page-content > main.min-h-screen > div {
          color: var(--althea-white);
        }
        .althea-page-content .althea-mobile-sales {
          min-height: calc(100dvh - 110px) !important;
          background: transparent !important;
          color: #f5f7f6 !important;
        }
        .althea-page-content .althea-mobile-sales .ams-content {
          width: 100% !important;
          max-width: 1100px !important;
          margin: 0 auto !important;
          padding: 4px 0 24px !important;
        }
        .althea-page-content .althea-mobile-sales .ams-search,
        .althea-page-content .althea-mobile-sales .ams-date-range,
        .althea-page-content .althea-mobile-sales .ams-filter,
        .althea-page-content .althea-mobile-sales .ams-period-line > button {
          border: 1px solid rgba(29,184,84,.18) !important;
          background: rgba(10,21,16,.82) !important;
          color: #e9efeb !important;
          border-radius: 14px !important;
        }
        .althea-page-content .althea-mobile-sales .ams-search input,
        .althea-page-content .althea-mobile-sales input[type='date'] {
          color: #f5f7f6 !important;
          background: transparent !important;
          font-family: inherit !important;
        }
        .althea-page-content .althea-mobile-sales .ams-search:focus-within,
        .althea-page-content .althea-mobile-sales .ams-date-range:focus-within {
          border-color: rgba(29,184,84,.55) !important;
          box-shadow: 0 0 0 3px rgba(29,184,84,.08) !important;
        }
        .althea-page-content .althea-mobile-sales .ams-filter,
        .althea-page-content .althea-mobile-sales .ams-period-line > button,
        .althea-page-content .althea-mobile-sales .ams-apply {
          color: #5fe187 !important;
          border-color: rgba(29,184,84,.28) !important;
        }
        .althea-page-content .althea-mobile-sales .ams-transactions,
        .althea-page-content .althea-mobile-sales .ams-summary article,
        .althea-page-content .althea-mobile-sales .ams-sheet {
          border: 1px solid rgba(255,255,255,.055) !important;
          background: #0d1511 !important;
          color: #f5f7f6 !important;
          border-radius: 20px !important;
        }
        .althea-page-content .althea-mobile-sales .ams-sale-row {
          background: transparent !important;
          color: #e7ece9 !important;
          border-color: rgba(255,255,255,.045) !important;
        }
        .althea-page-content .althea-mobile-sales .ams-sale-row:hover {
          background: rgba(29,184,84,.035) !important;
        }
        .althea-page-content .althea-mobile-sales .ams-sale-value,
        .althea-page-content .althea-mobile-sales .ams-summary strong {
          color: #ffffff !important;
        }
        .althea-page-content .althea-mobile-sales .ams-sale-status.paid {
          color: #5fe187 !important;
          border-color: rgba(29,184,84,.25) !important;
          background: rgba(29,184,84,.07) !important;
        }
        .althea-page-content .althea-mobile-sales .ams-inline-menu {
          border: 1px solid rgba(29,184,84,.18) !important;
          background: #09130f !important;
          box-shadow: 0 20px 60px rgba(0,0,0,.45) !important;
        }
        .althea-page-content .althea-mobile-sales .ams-inline-menu button:hover {
          background: rgba(29,184,84,.08) !important;
          color: #5fe187 !important;
        }
      `}</style>
    </MobileShell>
  )
}
