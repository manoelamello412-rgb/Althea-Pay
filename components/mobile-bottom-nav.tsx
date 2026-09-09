'use client'

import React, { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutGrid, Network, MessageCircle, Sparkles, GitBranch } from 'lucide-react'

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

  useEffect(() => {
    setActiveTab(tabFromPath(pathname))
  }, [pathname])

  useEffect(() => {
    const handler = (event: Event) => {
      const page = (event as CustomEvent<string>).detail
      const item = navItems.find((entry) => entry.id === page || entry.path === page || entry.path === `/dashboard/${page}`)
      if (item) setActiveTab(item.id)
    }

    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  const selectTab = (tab: TabId) => {
    const item = navItems.find((entry) => entry.id === tab)
    if (!item) return
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: item.path }))
    if (pathname !== item.path) router.push(item.path)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] px-4 pb-5 pt-2 sm:px-6 sm:pb-6">
      <nav
        aria-label="Navegação principal"
        className="pointer-events-auto mx-auto flex h-16 w-full max-w-md items-center justify-between rounded-full border border-[#0D362D] bg-[#071711]/95 px-2 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
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
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-1.5 inset-x-1 rounded-[22px] border transition-all duration-300 ${
                  isActive
                    ? 'border-emerald-500/20 bg-emerald-500/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]'
                    : 'border-transparent bg-transparent group-hover:bg-white/[0.02]'
                }`}
              />
              <Icon
                aria-hidden="true"
                className={`relative z-10 h-[19px] w-[19px] shrink-0 transition-all duration-200 ${
                  isActive ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'text-zinc-500 group-hover:text-zinc-300'
                }`}
                strokeWidth={isActive ? 2.5 : 2.1}
              />
              <span
                className={`relative z-10 max-w-full truncate text-[10px] leading-none tracking-tight transition-colors duration-200 ${
                  isActive ? 'font-semibold text-emerald-400' : 'font-medium text-zinc-500 group-hover:text-zinc-300'
                }`}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default MobileBottomNav
