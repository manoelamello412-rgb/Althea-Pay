'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface HeaderProps {
  userName?: string
  currentScreen?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export function MobileHeaderDashboard({ userName, currentScreen = 'DASHBOARD', onRefresh, refreshing = false }: HeaderProps) {
  const dbRef = useRef<SupabaseClient | null>(null)
  const [profileName, setProfileName] = useState('')
  const [hideValues, setHideValues] = useState(false)
  const [currentTime, setCurrentTime] = useState('')

  useEffect(() => {
    let active = true
    try {
      const db = createSupabaseBrowserClient()
      dbRef.current = db
      void (async () => {
        const { data: auth } = await db.auth.getUser()
        if (!active || !auth.user) return
        const metadata = auth.user.user_metadata as Record<string, unknown> | null
        const metadataName = String(metadata?.full_name ?? metadata?.name ?? '').trim()
        const { data: profile } = await db.from('profiles').select('display_name').eq('id', auth.user.id).maybeSingle()
        if (!active) return
        const displayName = String(profile?.display_name ?? '').trim()
        const emailName = String(auth.user.email ?? '').split('@')[0].trim()
        setProfileName(displayName || metadataName || emailName || 'Usuário')
      })()
    } catch {
      dbRef.current = null
    }
    return () => { active = false }
  }, [])

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date()
      setCurrentTime(`${now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
    }
    updateDateTime()
    const interval = window.setInterval(updateDateTime, 1000)
    return () => window.clearInterval(interval)
  }, [])

  const greetingName = userName?.trim() || profileName || 'Usuário'

  return (
    <div className="w-full select-none bg-[#0B0B0D] text-white">
      <header className="fixed left-0 right-0 top-0 z-[60] flex h-16 w-full items-center justify-between border-b border-[#0D362D] bg-[#0F1A16]/95 px-4 backdrop-blur-xl transform-gpu will-change-transform" style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-[#0D362D] bg-[#0B0B0D] shadow-[0_8px_24px_rgba(29,139,84,.08)]">
            <img src="/althea-logo.png" alt="ALTHEA PAY" className="h-full w-full object-contain p-1.5" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-bold tracking-[0.16em] text-slate-100">ALTHEA PAY</span>
            <span className="text-[10px] font-bold tracking-[0.22em] text-[#1D8B54]">{currentScreen}</span>
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={onRefresh} disabled={!onRefresh || refreshing} aria-label="Atualizar dashboard" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#0D362D] bg-[#0B0B0D] text-slate-300 outline-none disabled:opacity-70 transform-gpu will-change-transform">
          <RefreshCw className={refreshing ? 'animate-spin' : ''} size={16} />
        </motion.button>
      </header>

      <div className="h-16" />
      <div className="flex flex-col gap-5 px-4 pb-2 pt-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Olá, {greetingName}!</h1>
            <motion.span animate={{ rotate: [0, 15, -10, 15, 0] }} transition={{ repeat: Infinity, duration: 1.5, repeatDelay: 1 }} className="origin-bottom-right text-2xl">👋</motion.span>
          </div>
          <p className="text-xs text-[#A6A6A6]">Aqui está o resumo da sua operação.</p>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <h2 className="text-xl font-bold tracking-tight text-white">Visão Geral</h2>
          <div className="flex items-center gap-1.5 text-xs text-[#A6A6A6]"><span className="text-[#1D8B54]">◷</span><span>Última atualização: {currentTime}</span></div>
        </div>
        <div className="mt-1 flex items-center gap-2.5">
          <motion.button whileTap={{ scale: 0.93 }} type="button" onClick={() => setHideValues((value) => !value)} aria-label={hideValues ? 'Exibir valores' : 'Ocultar valores'} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#0D362D] bg-[#0F1A16] outline-none">
            {hideValues ? <EyeOff className="h-4 w-4 text-[#1D8B54]" /> : <Eye className="h-4 w-4 text-slate-300" />}
          </motion.button>
        </div>
      </div>
    </div>
  )
}
