'use client'
import {WhiteLabelWorkspace} from '@/components/white-label-workspace'
import DashboardPeriodController from '@/components/dashboard-period-controller'
import MobileBottomNav from '@/components/mobile-bottom-nav'
import DashboardMobile from '@/components/dashboard-mobile'
import SalesMobile from '@/components/sales-mobile'
import {hydrateAltheaBrand} from '@/components/brand-kit'
import {useEffect} from 'react'

export default function DashboardPage(){
  useEffect(()=>{hydrateAltheaBrand()},[])
  return <>
    <DashboardPeriodController/>
    <div className="althea-mobile-stage-host"><div className="althea-mobile-dashboard-host"><DashboardMobile stats={{revenue:0,transactions:0,averageTicket:0,newCustomers:0}}/></div><SalesMobile/></div>
    <WhiteLabelWorkspace/>
    <MobileBottomNav/>
  </>
}
