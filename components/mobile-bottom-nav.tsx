'use client'

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
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
    <footer className="fixed bottom-0 left-0 right-0 h-20 bg-[#0F1A16] border-t border-[#0D362D] px-3 flex items-center justify-between z-50 select-none pb-safe">
      {navItems.map((item) => {
        const isActive = activeTab === item.id
        const Icon = item.icon

        return (
          <motion.button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className="relative flex flex-col items-center justify-center flex-1 h-16 rounded-xl outline-none cursor-pointer group"
            whileTap={{ scale: 0.93 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            {isActive && (
              <motion.div
                layoutId="activeTabPill"
                className="absolute inset-x-1 inset-y-0.5 bg-[#0B0B0D] border border-[#0D362D] rounded-xl -z-10"
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              />
            )}

            <Icon
              className={`h-5 w-5 transition-all duration-200 ${
                isActive ? 'text-[#1D8B54] stroke-[2.5]' : 'text-[#A6A6A6] stroke-[2]'
              }`}
            />

            <span
              className={`text-[10px] font-medium mt-1 tracking-wide transition-colors duration-200 ${
                isActive ? 'text-[#1D8B54]' : 'text-[#A6A6A6]'
              }`}
            >
              {item.label}
            </span>
          </motion.button>
        )
      })}
    </footer>
  )
}
