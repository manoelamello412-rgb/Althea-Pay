'use client'
import {WhiteLabelWorkspace} from '@/components/white-label-workspace'
import DashboardPeriodController from '@/components/dashboard-period-controller'
import MobileBottomNav from '@/components/mobile-bottom-nav'
import DashboardMobile from '@/components/dashboard-mobile'
import SalesMobile from '@/components/sales-mobile'
import GatewaysMobile from '@/components/gateways-mobile'
import {hydrateAltheaBrand} from '@/components/brand-kit'
import {useEffect,useState} from 'react'

export default function DashboardPage(){
  const [mobilePage,setMobilePage]=useState('dashboard')
  useEffect(()=>{hydrateAltheaBrand();const handler=(event:Event)=>setMobilePage((event as CustomEvent<string>).detail||'dashboard');window.addEventListener('althea-mobile-page',handler);return()=>window.removeEventListener('althea-mobile-page',handler)},[])
  return <>
    <DashboardPeriodController/>
    <div className="althea-mobile-stage-host">
      <div className="althea-mobile-dashboard-host" style={{display:mobilePage==='dashboard'?'block':'none'}}><DashboardMobile stats={{revenue:0,transactions:0,averageTicket:0,newCustomers:0}}/></div>
      <div style={{display:mobilePage==='vendas'?'block':'none'}}><SalesMobile/></div>
      <div style={{display:mobilePage==='gateways'?'block':'none'}}><GatewaysMobile/></div>
    </div>
    <WhiteLabelWorkspace/>
    <MobileBottomNav/>
  </>
}
