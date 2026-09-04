'use client'

import { WhiteLabelWorkspace } from '@/components/white-label-workspace'
import MobileBottomNav from '@/components/mobile-bottom-nav'
import DashboardControl from '@/components/dashboard-control'
import SalesMobile from '@/components/sales-mobile'
import GatewaysMobile from '@/components/gateways-mobile'
import FunnelsMobile from '@/components/funnels-mobile'
import SettingsMobile from '@/components/settings-mobile'
import { hydrateAltheaBrand } from '@/components/brand-kit'
import { useEffect, useState } from 'react'

export default function DashboardPage() {
  const [mobilePage, setMobilePage] = useState('dashboard')

  useEffect(() => {
    hydrateAltheaBrand()
    const handler = (event: Event) => setMobilePage((event as CustomEvent<string>).detail || 'dashboard')
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  const mobile = ['dashboard', 'vendas', 'funis', 'gateways', 'configuracoes'].includes(mobilePage)

  return <>
    <div className="althea-mobile-stage-host" style={{ display: mobile ? 'block' : 'none' }}>
      <div style={{ display: mobilePage === 'dashboard' ? 'block' : 'none' }}><DashboardControl /></div>
      <div style={{ display: mobilePage === 'vendas' ? 'block' : 'none' }}><SalesMobile /></div>
      <div style={{ display: mobilePage === 'funis' ? 'block' : 'none' }}><FunnelsMobile /></div>
      <div style={{ display: mobilePage === 'gateways' ? 'block' : 'none' }}><GatewaysMobile /></div>
      <div style={{ display: mobilePage === 'configuracoes' ? 'block' : 'none' }}><SettingsMobile /></div>
    </div>
    <div style={{ display: mobile ? 'none' : 'block' }}><WhiteLabelWorkspace /></div>
    <div style={{ display: mobile ? 'none' : 'block' }}><MobileBottomNav /></div>
  </>
}
