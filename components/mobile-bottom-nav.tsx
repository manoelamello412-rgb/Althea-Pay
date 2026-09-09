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

  useEffect(() => setActiveTab(tabFromPath(pathname)), [pathname])

  const selectTab = (tab: TabId) => {
    const item = navItems.find((entry) => entry.id === tab)
    if (!item) return
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: item.path }))
    if (pathname !== item.path) router.push(item.path)
  }

  return (
    <div className="althea-legacy-bottom-nav pointer-events-none fixed inset-x-0 bottom-0 z-[70] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 sm:px-4">
      <nav aria-label="Navegação principal" className="pointer-events-auto mx-auto flex h-[72px] w-full max-w-[1106px] items-center justify-between gap-1 rounded-[38px] border border-white/[0.12] bg-[#090b0a]/96 px-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.62)] backdrop-blur-2xl">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          const Icon = item.icon
          return (
            <button key={item.id} type="button" onClick={() => selectTab(item.id)} aria-current={isActive ? 'page' : undefined} aria-label={item.label} className={`group relative flex h-[66px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[32px] px-1.5 py-2 transition-all duration-200 ${isActive ? 'text-[#e9fff0]' : 'text-[#777f7b] hover:text-white'}`}>
              <span aria-hidden="true" className={`absolute inset-0 rounded-[30px] border ${isActive ? 'border-[#1DB854]/25 bg-[#0b2418] shadow-[inset_0_0_24px_rgba(29,184,84,0.06)]' : 'border-transparent bg-transparent group-hover:bg-white/[0.02]'}`} />
              <Icon aria-hidden="true" className="relative z-10" size={28} strokeWidth={isActive ? 2.05 : 1.8} />
              <span className="relative z-10 text-[11px] font-medium leading-none">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default MobileBottomNav
