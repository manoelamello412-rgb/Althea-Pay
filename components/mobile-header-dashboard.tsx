'use client'

import Image from 'next/image'
import { Settings, Search } from 'lucide-react'

interface HeaderProps {
  pageTitle?: string
  currentScreen?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export function MobileHeaderDashboard({ pageTitle, currentScreen }: HeaderProps) {
  const title = (pageTitle?.trim() || currentScreen?.trim() || 'DASHBOARD').toUpperCase()

  return (
    <header className="sticky top-0 z-[60] w-full border-b border-white/[0.05] bg-[#09090b]/92 px-4 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            <Image src="/althea-mark.png" alt="Althea Pay Logo" width={24} height={24} priority className="object-contain drop-shadow-[0_0_7px_rgba(16,185,129,0.2)]" />
          </div>
          <div className="h-4 w-px shrink-0 bg-white/[0.08]" />
          <h1 className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">ALTHEA PAY <span className="text-zinc-600">//</span> {title}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" aria-label="Buscar" onClick={() => window.dispatchEvent(new CustomEvent('althea-open-search'))} className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.04] hover:text-white active:bg-white/[0.06]">
            <Search className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button type="button" aria-label="Configurações" onClick={() => window.dispatchEvent(new CustomEvent('althea-open-settings'))} className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/[0.04] hover:text-white active:bg-white/[0.06]">
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  )
}

export default MobileHeaderDashboard
