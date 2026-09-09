'use client'

import Image from 'next/image'
import { Settings, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface HeaderProps {
  pageTitle?: string
  currentScreen?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export function MobileHeaderDashboard({ pageTitle, currentScreen }: HeaderProps) {
  const router = useRouter()
  const title = (pageTitle?.trim() || currentScreen?.trim() || 'DASHBOARD').toUpperCase()

  return (
    <header className="sticky top-0 z-[60] w-full border-b border-white/[0.08] bg-[#070908]/95 px-4 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-3">
        <button type="button" onClick={() => router.push('/dashboard')} aria-label="Voltar ao Dashboard" className="flex min-w-0 items-center">
          <Image src="/althea-logo-inner.PNG" alt="ALTHEA PAY" width={132} height={28} priority className="h-7 w-auto object-contain" />
        </button>

        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          <h1 className="truncate text-right text-[11px] font-semibold tracking-[0.12em] text-[#d1d8d4]">// {title}</h1>
          <button type="button" aria-label="Buscar" onClick={() => window.dispatchEvent(new CustomEvent('althea-open-search'))} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.06] text-[#a8b0ac] transition hover:border-[#1DB854]/40 hover:bg-[#0d1a13] hover:text-[#1DB854]">
            <Search size={17} strokeWidth={1.9} />
          </button>
          <button type="button" aria-label="Configurações" onClick={() => router.push('/dashboard/settings')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.06] text-[#a8b0ac] transition hover:border-[#1DB854]/40 hover:bg-[#0d1a13] hover:text-[#1DB854]">
            <Settings size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  )
}

export default MobileHeaderDashboard
