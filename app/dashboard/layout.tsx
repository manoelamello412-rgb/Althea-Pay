'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MobileShell, { attendantAllows, type MobileShellTab } from '@/components/mobile-shell'
import { ConnectionStatus } from '@/components/connection-status'

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
  // The database already denies attendants everything outside customer service; this keeps them off those screens.
  const [attendant, setAttendant] = useState(false)
  useEffect(() => {
    let active = true
    import('@/lib/supabase/client').then(async ({ createSupabaseBrowserClient }) => {
      const db = createSupabaseBrowserClient()
      const { data } = db ? await db.rpc('organization_my_access_v1', { p_organization_id: null }) : { data: null }
      if (active) setAttendant((data as { role?: string } | null)?.role === 'attendant')
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  useEffect(() => { if (attendant && !attendantAllows(pathname)) router.replace('/dashboard/crm') }, [attendant, pathname, router])
  const selectTab = useCallback((tab: MobileShellTab) => {
    const route = routes[tab]
    if (route !== pathname) router.push(route)
  }, [pathname, router])

  return (
    <MobileShell activeTab={activeTab} onTabChange={selectTab} attendant={attendant}>
      <ConnectionStatus />
      <div className="althea-page-content">{attendant && !attendantAllows(pathname) ? null : children}</div>

    </MobileShell>
  )
}
