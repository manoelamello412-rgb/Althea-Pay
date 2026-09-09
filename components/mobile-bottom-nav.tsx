'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { GitBranch, LayoutGrid, MessageCircle, Network, Sparkles } from 'lucide-react'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutGrid },
  { id: 'gateway', label: 'Gateway', path: '/dashboard/gateways', icon: Network },
  { id: 'chat', label: 'Chat', path: '/dashboard/crm', icon: MessageCircle },
  { id: 'ia', label: 'IA', path: '/dashboard/ia', icon: Sparkles },
  { id: 'funil', label: 'Funil', path: '/dashboard/funil', icon: GitBranch },
] as const

type TabId = (typeof navItems)[number]['id']

function tabFromPath(pathname: string): TabId {
  if (pathname === '/dashboard' || pathname === '/dashboard/') return 'dashboard'
  if (pathname.startsWith('/dashboard/gateways')) return 'gateway'
  if (pathname.startsWith('/dashboard/crm')) return 'chat'
  if (pathname.startsWith('/dashboard/ia')) return 'ia'
  if (pathname.startsWith('/dashboard/funil')) return 'funil'
  return 'dashboard'
}

export function MobileBottomNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [activeTab, setActiveTab] = useState<TabId>(() => tabFromPath(pathname))

  useEffect(() => setActiveTab(tabFromPath(pathname)), [pathname])

  const selectTab = (tab: TabId) => {
    const item = navItems.find((entry) => entry.id === tab)
    if (!item) return
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: item.path }))
    if (pathname !== item.path) router.push(item.path)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 sm:px-4">
      <nav
        aria-label="Navegação principal"
        className="pointer-events-auto mx-auto flex h-16 w-full max-w-md items-center justify-between gap-1 rounded-full border border-white/[0.06] bg-[color-mix(in_srgb,var(--althea-inner)_40%,transparent)] px-2 shadow-[0_32px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              className={`group relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-1 py-1 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)] ${isActive ? 'text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-1.5 inset-x-0.5 rounded-full border transition-all duration-200 ${isActive ? 'border-[rgba(29,187,84,0.2)] bg-[rgba(29,187,84,0.08)] shadow-[inset_0_0_24px_rgba(29,187,84,0.06)]' : 'border-transparent group-hover:bg-white/[0.02]'}`}
              />
              <Icon aria-hidden="true" className="relative z-10 h-4 w-4" strokeWidth={isActive ? 2 : 1.8} />
              <span className="relative z-10 truncate text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default MobileBottomNav
