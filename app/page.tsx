'use client'
import {WhiteLabelWorkspace} from '@/components/white-label-workspace'
import {hydrateAltheaBrand} from '@/components/brand-kit'
import {useEffect} from 'react'
export default function DashboardPage(){useEffect(()=>{hydrateAltheaBrand()},[]);return <WhiteLabelWorkspace/>}
