'use client'

import { useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MobileShell, { type MobileShellTab } from '@/components/mobile-shell'

const routes: Record<MobileShellTab, string> = { dashboard: '/dashboard', vendas: '/dashboard/vendas', chat: '/dashboard/crm', ia: '/dashboard/ia', funil: '/dashboard/funil' }

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
      <div className="althea-page-content">{children}</div>
      <style jsx global>{`
        .althea-page-content { font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif; color: var(--althea-white); }

        /* A MobileShell é a única barra global de navegação. Escondemos somente
           barras legadas conhecidas; headers semânticos das páginas permanecem visíveis. */
        .althea-page-content .al-chat-top,
        .althea-page-content .al-bottom-nav,
        .althea-page-content .althea-legacy-bottom-nav,
        .althea-page-content .ams-header,
        .althea-page-content .ams-bottom-nav { display: none !important; }

        .althea-page-content > div.min-h-screen,
        .althea-page-content > main.min-h-screen { min-height: calc(100dvh - 56px) !important; background: var(--althea-bg) !important; color: var(--althea-white) !important; }
        .althea-page-content > div.min-h-screen > main,
        .althea-page-content > main.min-h-screen > div { color: var(--althea-white); }

        /* Barra inferior: mais fina, discreta e translúcida; somente ícones e
           nomes permanecem visualmente destacados. */
        nav[aria-label="Navegação operacional"] {
          padding-top: 4px !important;
          padding-left: 10px !important;
          padding-right: 10px !important;
        }
        nav[aria-label="Navegação operacional"] > div {
          height: 58px !important;
          padding: 3px !important;
          gap: 0 !important;
          border-radius: 29px !important;
          border-color: rgba(255,255,255,.035) !important;
          background: rgba(3,8,6,.58) !important;
          box-shadow: 0 14px 38px rgba(0,0,0,.34) !important;
          backdrop-filter: blur(18px) saturate(120%) !important;
          -webkit-backdrop-filter: blur(18px) saturate(120%) !important;
        }
        nav[aria-label="Navegação operacional"] button {
          min-width: 0 !important;
          border-color: transparent !important;
          background: transparent !important;
        }


        @media (max-width: 640px) {
          .althea-page-content > div.min-h-screen > main,
          .althea-page-content > main.min-h-screen > div { min-width: 0 !important; }
        }
      `}</style>
    </MobileShell>
  )
}
