'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, RefreshCw, Server } from 'lucide-react'
import { motion } from 'framer-motion'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface ProviderStatus { id: string; name: string; provider: string; status: 'stable' | 'unstable' | 'unavailable'; rawStatus: string }

interface PerformanceProps { onBack: () => void }

function classifyGateway(status: string): ProviderStatus['status'] {
  if (status === 'connected') return 'stable'
  if (status === 'degraded' || status === 'error') return 'unstable'
  return 'unavailable'
}

export function ConfigTabPerformance({ onBack }: PerformanceProps) {
  const [edgeLatency, setEdgeLatency] = useState<number | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [providerError, setProviderError] = useState<string | null>(null)

  const loadProviders = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase
        .from('gateways')
        .select('id,display_name,provider,status')
        .order('display_name', { ascending: true })
      if (error) throw error
      setProviders((data ?? []).map((row: { id: string; display_name?: string | null; provider?: string | null; status?: string | null }) => ({
        id: row.id,
        name: row.display_name?.trim() || row.provider?.trim() || 'Gateway sem nome',
        provider: row.provider?.trim() || 'provider_desconhecido',
        rawStatus: row.status ?? 'unknown',
        status: classifyGateway(row.status ?? 'unknown'),
      })))
      setProviderError(null)
    } catch (error) {
      setProviders([])
      setProviderError(error instanceof Error ? error.message : 'Falha ao carregar gateways.')
    }
  }, [])

  const check = useCallback(async () => {
    setIsSyncing(true)
    const started = performance.now()
    try {
      const response = await fetch('/api/health/supabase', { cache: 'no-store' })
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
    void loadProviders()
    const interval = window.setInterval(() => void check(), 2500)
    return () => window.clearInterval(interval)
  }, [check, loadProviders])

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
        <span className="pl-1 text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">Gateways conectadas</span>
        {providerError ? <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-[10px] text-amber-300">Não foi possível carregar as conexões: {providerError}</div> : null}
        {!providerError && providers.length === 0 ? <div className="rounded-xl border border-zinc-900 bg-[#0F1A16]/40 p-3 text-[10px] leading-relaxed text-zinc-500">Nenhuma gateway cadastrada. Esta área reflete automaticamente as conexões reais criadas no painel de Gateways.</div> : null}
        {providers.map((provider) => {
          const operational = provider.status === 'stable'
          const warning = provider.status === 'unstable'
          return <div key={provider.id} className="flex items-center justify-between rounded-xl border border-zinc-900 bg-[#0F1A16]/60 p-3">
            <div className="flex min-w-0 items-center gap-2.5"><div className={`h-1.5 w-1.5 shrink-0 rounded-full ${operational ? 'bg-[#1DB854]' : warning ? 'bg-amber-400' : 'bg-zinc-700'}`} /><div className="truncate"><span className="block text-xs font-bold text-zinc-300">{provider.name}</span><span className="block truncate text-[10px] text-zinc-600">{provider.provider}</span></div></div>
            <div className="flex shrink-0 items-center gap-2"><div className="text-right"><span className={`text-[9px] font-bold uppercase tracking-tighter ${operational ? 'text-[#1DB854]' : warning ? 'text-amber-300' : 'text-zinc-600'}`}>{provider.rawStatus}</span><p className="text-[9px] text-zinc-600">estado da conexão</p></div>{operational ? <CheckCircle2 className="h-3.5 w-3.5 text-[#1DB854]" /> : <AlertTriangle className={`h-3.5 w-3.5 ${warning ? 'text-amber-400' : 'text-zinc-700'}`} />}</div>
          </div>
        })}
      </div>
    </div>
  )
}
