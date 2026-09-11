'use client'

import { Search, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import BrandLogo from '@/components/brand-logo'

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
    <header className="sticky top-0 z-[60] w-full border-b border-white/[0.04] bg-[color-mix(in_srgb,var(--althea-bg)_86%,transparent)] px-4 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          aria-label="Voltar ao Dashboard"
          className="flex min-w-0 items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)]"
        >
          <BrandLogo variant="inner" priority alt="ALTHEA PAY" className="h-7 w-auto max-w-[118px] object-contain drop-shadow-[0_0_20px_rgba(29,187,84,0.2)]" />
        </button>

        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          <h1 className="truncate text-right font-mono text-[10px] font-semibold tracking-[0.12em] text-[var(--althea-muted)]">
            // {title}
          </h1>
          <button
            type="button"
            aria-label="Buscar"
            onClick={() => window.dispatchEvent(new CustomEvent('althea-open-search'))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.04] text-[var(--althea-muted)] transition hover:border-[rgba(29,187,84,0.2)] hover:bg-[rgba(29,187,84,0.08)] hover:text-[var(--althea-brand)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)]"
          >
            <Search size={16} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            aria-label="Configurações"
            onClick={() => router.push('/dashboard/settings')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.04] text-[var(--althea-muted)] transition hover:border-[rgba(29,187,84,0.2)] hover:bg-[rgba(29,187,84,0.08)] hover:text-[var(--althea-brand)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,187,84,0.4)]"
          >
            <Settings size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  )
}

export default MobileHeaderDashboard
