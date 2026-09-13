'use client'

import { useEffect, useState } from 'react'
import AltheaDashboardControl from '@/components/althea-dashboard-control'
import SalesMobile from '@/components/sales-mobile'

export default function DashboardPage() {
  const [mobilePage, setMobilePage] = useState('dashboard')

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      setMobilePage(detail || 'dashboard')
    }
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  return (
    <>
      <div className={mobilePage === 'dashboard' ? 'block' : 'hidden'}>
        <AltheaDashboardControl />
      </div>
      <div className={mobilePage === 'vendas' ? 'block' : 'hidden'}>
        <SalesMobile />
      </div>
    </>
  )
}
