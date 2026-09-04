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
    <footer
      className="fixed z-50 select-none"
      style={{
        left: '30px',
        right: '30px',
        bottom: '28px',
        height: '190px',
        padding: '26px 20px 22px',
        borderRadius: '38px',
        background: 'rgba(15, 26, 22, 0.97)',
        border: '2px solid rgba(63, 77, 70, 0.72)',
        boxShadow: '0 18px 50px rgba(0,0,0,.30)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <div className="grid h-full grid-cols-5 items-center gap-2">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          const Icon = item.icon

          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => selectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex h-full min-w-0 flex-col items-center justify-center rounded-[30px] outline-none"
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTabPill"
                  className="absolute inset-[0_0_0_0] -z-10 rounded-[30px]"
                  style={{
                    background: '#0B0B0D',
                    border: '1px solid rgba(13, 54, 45, 0.95)',
                  }}
                  transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                />
              )}

              <Icon
                className="h-11 w-11 shrink-0 transition-all duration-200"
                strokeWidth={isActive ? 2.6 : 2.2}
                style={{ color: isActive ? '#1DB854' : '#8A9A92' }}
              />

              <span
                className="mt-3 whitespace-nowrap text-[18px] font-medium tracking-[-0.01em] transition-colors duration-200"
                style={{ color: isActive ? '#1DB854' : '#8A9A92' }}
              >
                {item.label}
              </span>
            </motion.button>
          )
        })}
      </div>
    </footer>
  )
}
