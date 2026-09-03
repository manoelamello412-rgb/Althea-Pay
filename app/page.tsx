'use client'
import {WhiteLabelWorkspace} from '@/components/white-label-workspace'
import DashboardPeriodController from '@/components/dashboard-period-controller'
import {hydrateAltheaBrand} from '@/components/brand-kit'
import {useEffect} from 'react'
export default function DashboardPage(){useEffect(()=>{hydrateAltheaBrand()},[]);return <><DashboardPeriodController/><WhiteLabelWorkspace/></>}
