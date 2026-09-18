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

        /* Vendas: normaliza as barras/controles para a mesma linguagem visual
           da ALTHEA PAY e evita que flex/overflow quebrem em telas estreitas. */
        .althea-mobile-sales,
        .althea-mobile-sales .ams-content { background: transparent !important; color: #fff !important; }
        .althea-mobile-sales .ams-content { width: 100% !important; max-width: 1180px !important; margin: 0 auto !important; padding-bottom: 24px !important; }
        .althea-mobile-sales .ams-search {
          display: flex !important; align-items: center !important; width: 100% !important; min-height: 44px !important;
          box-sizing: border-box !important; overflow: hidden !important; border: 1px solid rgba(255,255,255,.055) !important;
          border-radius: 13px !important; background: rgba(8,15,12,.72) !important; color: #8a9690 !important;
          box-shadow: none !important;
        }
        .althea-mobile-sales .ams-search input { min-width: 0 !important; flex: 1 1 auto !important; background: transparent !important; color: #fff !important; }
        .althea-mobile-sales .ams-filter,
        .althea-mobile-sales button[aria-haspopup="dialog"] {
          min-height: 42px !important; box-sizing: border-box !important; border: 1px solid rgba(255,255,255,.055) !important;
          border-radius: 12px !important; background: rgba(8,15,12,.72) !important; color: #d7ddd9 !important;
        }
        .althea-mobile-sales .ams-transactions {
          margin-top: 16px !important; overflow: hidden !important; border: 1px solid rgba(255,255,255,.05) !important;
          border-radius: 16px !important; background: rgba(5,10,8,.66) !important;
        }
        .althea-mobile-sales .ams-table-head {
          display: grid !important; grid-template-columns: minmax(0,1fr) minmax(82px,.4fr) minmax(90px,.42fr) !important;
          align-items: center !important; gap: 12px !important; min-height: 42px !important;
          box-sizing: border-box !important; border-bottom: 1px solid rgba(255,255,255,.045) !important;
          background: rgba(255,255,255,.012) !important; color: #68736d !important;
        }
        .althea-mobile-sales .ams-list { width: 100% !important; }
        .althea-mobile-sales .ams-sale-row {
          display: grid !important; grid-template-columns: minmax(0,1fr) minmax(82px,.4fr) minmax(90px,.42fr) !important;
          align-items: center !important; gap: 12px !important; width: 100% !important; min-width: 0 !important;
          box-sizing: border-box !important; border-bottom: 1px solid rgba(255,255,255,.035) !important;
          background: transparent !important; color: #fff !important; text-align: left !important;
        }
        .althea-mobile-sales .ams-sale-row:last-child { border-bottom: 0 !important; }
        .althea-mobile-sales .ams-sale-client { min-width: 0 !important; overflow: hidden !important; }
        .althea-mobile-sales .ams-sale-client b,
        .althea-mobile-sales .ams-sale-client small { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
        .althea-mobile-sales .ams-sale-value { color: #f2f5f3 !important; }
        .althea-mobile-sales .ams-sale-status.paid { color: #62df89 !important; background: rgba(29,187,84,.08) !important; border-color: rgba(29,187,84,.16) !important; }
        .althea-mobile-sales .ams-sale-status.pending { color: #e4b65b !important; background: rgba(228,182,91,.07) !important; border-color: rgba(228,182,91,.14) !important; }
        .althea-mobile-sales .ams-sale-status.other { color: #9ba59f !important; background: rgba(255,255,255,.035) !important; border-color: rgba(255,255,255,.06) !important; }

        @media (max-width: 640px) {
          .althea-page-content > div.min-h-screen > main,
          .althea-page-content > main.min-h-screen > div { min-width: 0 !important; }
          .althea-mobile-sales .ams-table-head,
          .althea-mobile-sales .ams-sale-row { grid-template-columns: minmax(0,1fr) auto !important; }
          .althea-mobile-sales .ams-table-head span:nth-child(2),
          .althea-mobile-sales .ams-sale-value { justify-self: end !important; }
          .althea-mobile-sales .ams-table-head span:nth-child(3),
          .althea-mobile-sales .ams-sale-status { grid-column: 2 !important; justify-self: end !important; }
          .althea-mobile-sales .ams-sale-client { grid-row: 1 / span 2 !important; }
        }
      `}</style>
    </MobileShell>
  )
}
