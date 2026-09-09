'use client'

import React, { useEffect, useState } from 'react'
import { LayoutGrid, CreditCard, GitFork, Network, Settings } from 'lucide-react'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'sales', label: 'Vendas', icon: CreditCard },
  { id: 'funnels', label: 'Funis', icon: GitFork },
  { id: 'gateway', label: 'Gateway', icon: Network },
  { id: 'settings', label: 'Configuração', icon: Settings },
] as const

const pageByTab = {
  dashboard: 'dashboard',
  sales: 'vendas',
  funnels: 'funis',
  gateway: 'gateways',
  settings: 'configuracoes',
} as const

type TabId = keyof typeof pageByTab

export default function MobileBottomNav() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')

  useEffect(() => {
    const handler = (event: Event) => {
      const page = (event as CustomEvent<string>).detail
      const next = (Object.entries(pageByTab) as [TabId, string][]).find(([, value]) => value === page)?.[0]
      if (next) setActiveTab(next)
    }

    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  const selectTab = (tab: TabId) => {
    setActiveTab(tab)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: pageByTab[tab] }))
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-5 pt-2 sm:px-6 sm:pb-6">
      <nav
        aria-label="Navegação principal"
        className="pointer-events-auto mx-auto flex h-16 w-full max-w-md items-center justify-between rounded-full border border-white/[0.06] bg-[#121214]/60 px-2 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl supports-[backdrop-filter]:bg-[#121214]/55"
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
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-1.5 inset-x-1 rounded-full border transition-all duration-300 ease-out ${
                  isActive
                    ? 'border-emerald-500/20 bg-emerald-500/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]'
                    : 'border-transparent bg-transparent group-hover:bg-white/[0.02]'
                }`}
              />

              <Icon
                aria-hidden="true"
                className={`relative z-10 h-[18px] w-[18px] shrink-0 transition-all duration-200 ${
                  isActive
                    ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]'
                    : 'text-zinc-500 group-hover:text-zinc-300'
                }`}
                strokeWidth={isActive ? 2.5 : 2.2}
              />

              <span
                className={`relative z-10 max-w-full truncate text-[10px] font-medium leading-none tracking-tight transition-colors duration-200 ${
                  isActive
                    ? 'font-semibold text-emerald-400'
                    : 'text-zinc-500 group-hover:text-zinc-300'
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
