'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, RefreshCw, Search } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface HeaderProps {
  userName?: string
  currentScreen?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export function MobileHeaderDashboard({ userName, currentScreen = 'DASHBOARD', onRefresh, refreshing = false }: HeaderProps) {
  const [profileName, setProfileName] = useState('')
  const [hideValues, setHideValues] = useState(false)
  const [currentTime, setCurrentTime] = useState('')

  useEffect(() => {
    let active = true
    const loadProfile = async () => {
      try {
        const db = createSupabaseBrowserClient()
        const { data: auth } = await db.auth.getUser()
        if (!active || !auth.user) return
        const metadata = auth.user.user_metadata as Record<string, unknown> | null
        const metadataName = String(metadata?.full_name ?? metadata?.name ?? '').trim()
        const { data: profile } = await db.from('profiles').select('display_name').eq('id', auth.user.id).maybeSingle()
        if (!active) return
        const displayName = String(profile?.display_name ?? '').trim()
        const emailName = String(auth.user.email ?? '').split('@')[0].trim()
        setProfileName(displayName || metadataName || emailName || 'Usuário')
      } catch {
        if (active) setProfileName('Usuário')
      }
    }
    void loadProfile()
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
  const title = currentScreen.trim() || 'DASHBOARD'

  return (
    <div className="w-full select-none bg-[#0B0B0D] text-white">
      <header className="fixed left-0 right-0 top-0 z-[60] h-14 w-full border-b border-white/[0.04] bg-[#09090b]/70 px-4 backdrop-blur-md transition-all duration-300 transform-gpu will-change-transform" style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }}>
        <div className="mx-auto flex h-full w-full items-center justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="relative flex h-6 w-6 shrink-0 items-center justify-center transition-transform active:scale-95">
              <Image src="/althea-mark.png" alt="Althea Pay Logo" width={24} height={24} priority className="object-contain drop-shadow-[0_0_6px_rgba(16,185,129,0.2)]" />
            </div>
            <div className="h-4 w-px shrink-0 bg-white/[0.08]" />
            <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-100">{title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" aria-label="Buscar" className="flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-zinc-400 transition-all duration-200 hover:bg-white/[0.03] hover:text-zinc-100 active:bg-white/[0.06]">
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={onRefresh} disabled={!onRefresh || refreshing} aria-label="Atualizar dashboard" className="group flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-zinc-400 transition-all duration-200 hover:bg-white/[0.03] hover:text-zinc-100 active:bg-white/[0.06] disabled:opacity-50">
              <RefreshCw className={refreshing ? 'h-[17px] w-[17px] animate-spin' : 'h-[17px] w-[17px] transition-transform duration-500 group-active:rotate-180'} strokeWidth={2} />
            </motion.button>
          </div>
        </div>
      </header>

      <div className="h-14" />
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
