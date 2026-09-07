'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, RefreshCw, Server } from 'lucide-react'
import { motion } from 'framer-motion'

interface ProviderStatus { name: string; latency: number | null; status: 'stable' | 'unstable' | 'unavailable'; successRate: number | null }

interface PerformanceProps { onBack: () => void }

const PROVIDERS = ['Cielo API', 'Rede Gateway', 'Stone Client', 'PagBank Engine']

function classify(latency: number | null): ProviderStatus['status'] {
  if (latency === null) return 'unavailable'
  return latency > 110 ? 'unstable' : 'stable'
}

export function ConfigTabPerformance({ onBack }: PerformanceProps) {
  const [edgeLatency, setEdgeLatency] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [providers, setProviders] = useState<ProviderStatus[]>(PROVIDERS.map((name) => ({ name, latency: null, status: 'unavailable', successRate: null })))

  const check = useCallback(async () => {
    setIsSyncing(true)
    const started = performance.now()
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      const latency = Math.max(1, Math.round(performance.now() - started))
      if (!response.ok) throw new Error('health check failed')
      setEdgeLatency(latency)
      setHistory((current) => [...current.slice(-10), latency])
    } catch {
      setEdgeLatency(null)
      setHistory((current) => [...current.slice(-10), 0])
    } finally {
      setIsSyncing(false)
    }
  }, [])

  useEffect(() => {
    void check()
    const interval = window.setInterval(() => void check(), 2500)
    return () => window.clearInterval(interval)
  }, [check])

  return (
    <div className="w-full flex flex-col gap-4 animate-fade-in pb-32 font-['Space_Grotesk'] text-left text-white">
      <div className="flex items-center justify-between border-b border-[#0D362D]/30 pb-2">
        <button type="button" onClick={onBack} className="flex cursor-pointer items-center gap-1.5 text-xs font-bold text-[#A6A6A6] transition-colors hover:text-white">
          <ChevronLeft className="h-4 w-4 text-[#1DB854]" />
          <span>Voltar</span>
        </button>
        <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1DB854]" /><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Telemetria Ativa</span></div>
      </div>

      <div className="relative mt-2 flex flex-col gap-3 overflow-hidden rounded-2xl border border-[#0D362D] bg-[#0F1A16] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#0D362D] bg-[#0B0B0D]"><Server className="h-4 w-4 text-[#1DB854]" /></div><div><h3 className="text-xs font-bold">Servidores de Borda</h3><p className="text-[10px] text-[#A6A6A6]">Althea Edge / API Health</p></div></div>
          <button type="button" onClick={() => void check()} disabled={isSyncing} aria-label="Atualizar telemetria" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[#0D362D] bg-[#0B0B0D] disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin text-[#1DB854]' : 'text-slate-400'}`} /></button>
        </div>
        <div className="flex items-baseline gap-1"><span className="text-3xl font-black tracking-tight">{edgeLatency ?? '—'}</span><span className="text-xs font-bold text-[#1DB854]">{edgeLatency === null ? '' : 'ms'}</span><span className="ml-2 text-[10px] font-medium text-[#A6A6A6]">Latência de ponta a ponta</span></div>
        <div className="flex h-7 items-end gap-1 border-t border-[#0D362D]/40 pt-1">
          {(history.length ? history : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, edgeLatency ?? 0]).map((value, index, values) => <motion.div key={`${index}-${value}`} className="flex-1 rounded-t-[2px] bg-[#1DB854]" animate={{ height: `${value ? Math.min(100, Math.max(8, (value / Math.max(...values.filter(Boolean), 1)) * 100)) : 8}%` }} transition={{ type: 'spring', stiffness: 200, damping: 14 }} style={{ opacity: 0.15 + index * 0.07 }} />)}
        </div>
      </div>

      <div className="mt-1 flex flex-col gap-2">
        <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">Status das APIs Externas</span>
        <div className="rounded-xl border border-zinc-900 bg-[#0F1A16]/40 p-3 text-[10px] leading-relaxed text-zinc-500">Nenhum conector de adquirente está vinculado a esta operação ainda. Os status abaixo serão preenchidos automaticamente quando as integrações reais forem configuradas.</div>
        {providers.map((provider) => <div key={provider.name} className="flex items-center justify-between rounded-xl border border-zinc-900 bg-[#0F1A16]/60 p-3">
          <div className="flex min-w-0 items-center gap-2.5"><div className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-700" /><div className="truncate"><span className="block text-xs font-bold text-zinc-300">{provider.name}</span><span className="block truncate text-[10px] text-zinc-600">Integração não configurada</span></div></div>
          <div className="flex shrink-0 items-center gap-2"><div className="text-right"><span className="font-mono text-xs font-bold text-zinc-600">—</span><p className="text-[9px] font-medium uppercase tracking-tighter text-zinc-600">Indisponível</p></div><AlertTriangle className="h-3.5 w-3.5 text-zinc-700" /></div>
        </div>)}
      </div>
    </div>
  )
}
