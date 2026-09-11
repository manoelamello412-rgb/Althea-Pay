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

export function MobileHeaderDashboard({}: HeaderProps) {
  const router = useRouter()

  return (
    <header className="hidden">
      <button type="button" onClick={() => router.push('/dashboard')} aria-label="Ir para o Dashboard">
        <BrandLogo variant="inner" priority alt="Althea Pay" className="h-8 w-auto max-w-[132px] object-contain" />
      </button>
      <button type="button" aria-label="Buscar" onClick={() => window.dispatchEvent(new CustomEvent('althea-open-search'))}><Search aria-hidden="true" /></button>
      <button type="button" aria-label="Configurações" onClick={() => router.push('/dashboard/settings')}><Settings aria-hidden="true" /></button>
    </header>
  )
}

export default MobileHeaderDashboard
