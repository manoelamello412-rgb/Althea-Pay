'use client'
import {WhiteLabelWorkspace} from '@/components/white-label-workspace'
import DashboardPeriodController from '@/components/dashboard-period-controller'
import MobileBottomNav from '@/components/mobile-bottom-nav'
import {hydrateAltheaBrand} from '@/components/brand-kit'
import {useEffect} from 'react'
export default function DashboardPage(){useEffect(()=>{hydrateAltheaBrand()},[]);return <><DashboardPeriodController/><WhiteLabelWorkspace/><MobileBottomNav/></>}
