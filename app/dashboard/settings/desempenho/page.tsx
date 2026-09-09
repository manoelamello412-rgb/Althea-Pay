'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, Clock3, Loader2, Radio, RefreshCw, ServerCog, TriangleAlert, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type HealthState = 'collecting' | 'operational' | 'degraded' | 'unstable'

type RoutingLog = {
  id: string
  status: string | null
  created_at: string
  completed_at: string | null
  gateways_attempted: unknown
  final_gateway: string | null
}

type Telemetry = {
  edgeLatencyMs: number | null
  acquirerLatencyMs: number | null
  stabilityRate: number | null
  coreAvailabilityRate: number | null
  lastChecked: string | null
  healthOk: boolean | null
}

type Ping = { id: string; latency: number; at: string; ok: boolean }

const MAX_PINGS = 20
const POLL_MS = 4000
const DEGRADED_EDGE_MS = 450
const DEGRADED_ACQUIRER_MS = 1500

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))))
}

function extractAttemptLatencies(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const raw = candidate.latency_ms ?? candidate.latencyMs ?? candidate.response_time_ms ?? candidate.responseTimeMs
    const latency = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    return Number.isFinite(latency) && latency >= 0 ? [latency] : []
  })
}

function routingLatency(log: RoutingLog): number | null {
  const attemptLatencies = extractAttemptLatencies(log.gateways_attempted)
  if (attemptLatencies.length) return Math.round(attemptLatencies.reduce((sum, value) => sum + value, 0) / attemptLatencies.length)
  if (!log.completed_at) return null
  const created = Date.parse(log.created_at)
  const completed = Date.parse(log.completed_at)
  if (!Number.isFinite(created) || !Number.isFinite(completed) || completed < created) return null
  return completed - created
}

function statusMeta(status: HealthState) {
  switch (status) {
    case 'operational': return { label: 'SISTEMA OPERACIONAL', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400', icon: CheckCircle2 }
    case 'degraded': return { label: 'SISTEMA DEGRADADO', className: 'border-amber-500/20 bg-amber-500/10 text-amber-400', icon: TriangleAlert }
    case 'unstable': return { label: 'INSTABILIDADE DETECTADA', className: 'border-rose-500/20 bg-rose-500/10 text-rose-400', icon: XCircle }
    default: return { label: 'COLETANDO DADOS', className: 'border-zinc-800 bg-zinc-900/40 text-zinc-500', icon: Activity }
  }
}

export default function PerformanceSettingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<RoutingLog[]>([])
  const [pings, setPings] = useState<Ping[]>([])
  const [telemetry, setTelemetry] = useState<Telemetry>({ edgeLatencyMs: null, acquirerLatencyMs: null, stabilityRate: null, coreAvailabilityRate: null, lastChecked: null, healthOk: null })

  const loadRoutingTelemetry = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) {
      router.replace('/login')
      return
    }

    const { data, error: queryError } = await supabase
      .from('transaction_routing_logs')
      .select('id,status,created_at,completed_at,gateways_attempted,final_gateway')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (queryError) throw queryError

    const nextLogs = (data ?? []) as RoutingLog[]
    setLogs(nextLogs)

    const latencies = nextLogs.map(routingLatency).filter((value): value is number => value !== null)
    const recent = nextLogs.slice(0, 20)
    const successful = recent.filter((item) => ['approved', 'completed', 'paid', 'success', 'succeeded'].includes(String(item.status ?? '').toLowerCase())).length
    const recentLatency = latencies.length ? Math.round(latencies.slice(0, 20).reduce((sum, value) => sum + value, 0) / Math.min(latencies.length, 20)) : null

    setTelemetry((current) => ({
      ...current,
      acquirerLatencyMs: recentLatency,
      stabilityRate: recent.length ? clampPercent((successful / recent.length) * 100) : null,
    }))
  }, [router, supabase])

  const executeEdgeTelemetryPing = useCallback(async () => {
    const started = performance.now()
    const checkedAt = new Date().toISOString()
    let ok = false
    let latency = 0

    try {
      const response = await fetch('/api/health/supabase', { cache: 'no-store' })
      const payload = (await response.json()) as { ok?: boolean; latency_ms?: number }
      latency = Math.max(0, Math.round(performance.now() - started))
      ok = response.ok && payload.ok === true
      setTelemetry((current) => ({
        ...current,
        edgeLatencyMs: latency,
        lastChecked: checkedAt,
        healthOk: ok,
      }))
    } catch {
      latency = Math.max(0, Math.round(performance.now() - started))
      setTelemetry((current) => ({ ...current, edgeLatencyMs: latency, lastChecked: checkedAt, healthOk: false }))
    }

    setPings((current) => [{ id: `${checkedAt}-${latency}`, latency, at: checkedAt, ok }, ...current].slice(0, MAX_PINGS))
    return ok
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      await Promise.all([executeEdgeTelemetryPing(), loadRoutingTelemetry()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a telemetria operacional.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [executeEdgeTelemetryPing, loadRoutingTelemetry])

  useEffect(() => {
    let active = true
    void refresh()

    const interval = window.setInterval(() => {
      if (active) void refresh()
    }, POLL_MS)

    const channel = supabase
      .channel('performance:transaction-routing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_routing_logs' }, () => {
        if (active) void loadRoutingTelemetry()
      })
      .subscribe()

    return () => {
      active = false
      window.clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [loadRoutingTelemetry, refresh, supabase])

  const health = useMemo<HealthState>(() => {
    if (telemetry.edgeLatencyMs === null || telemetry.healthOk === null) return 'collecting'
    if (!telemetry.healthOk || (telemetry.stabilityRate !== null && telemetry.stabilityRate < 95)) return 'unstable'
    if (telemetry.edgeLatencyMs > DEGRADED_EDGE_MS || (telemetry.acquirerLatencyMs !== null && telemetry.acquirerLatencyMs > DEGRADED_ACQUIRER_MS)) return 'degraded'
    return 'operational'
  }, [telemetry])

  const meta = statusMeta(health)
  const StatusIcon = meta.icon
  const lastCheck = telemetry.lastChecked ? new Date(telemetry.lastChecked).toLocaleTimeString('pt-BR') : '—'

  return (
    <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased font-sans">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[#191921] bg-[#0b0b0f]/95 px-4 backdrop-blur sm:px-6">
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="min-h-11 px-1 text-xs font-mono text-zinc-400 transition hover:text-white">← VOLTAR</button>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500"><Radio size={13} className="text-[#1DB854]"/> Desempenho</div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-4 p-4 pb-32 sm:p-6 sm:pb-32">
        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-[#1DB854]/20 bg-[#0f1a16] text-[#1DB854]"><ServerCog size={18}/></span><div><h1 className="text-lg font-bold tracking-tight">Saúde da Plataforma</h1><p className="text-[11px] text-zinc-500">Telemetria real de borda e roteamento transacional.</p></div></div>
            <div className={`inline-flex min-h-9 items-center gap-2 self-start rounded-full border px-3 text-[10px] font-bold tracking-wide ${meta.className}`}><StatusIcon size={13}/>{meta.label}</div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Metric label="Latência de Borda" value={telemetry.edgeLatencyMs} suffix="ms" description="Tempo medido do cliente até a resposta da rota de health." />
            <Metric label="Latência de Adquirentes" value={telemetry.acquirerLatencyMs} suffix="ms" description="Média dos tempos observados nos logs reais de roteamento." />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard label="Estabilidade do Roteamento" value={telemetry.stabilityRate === null ? '—' : `${telemetry.stabilityRate.toFixed(1)}%`} icon={<Activity size={15}/>} description="Sucesso dos últimos eventos de roteamento disponíveis para esta conta." />
          <MetricCard label="Disponibilidade do Core" value={telemetry.coreAvailabilityRate === null ? '—' : `${telemetry.coreAvailabilityRate.toFixed(1)}%`} icon={<CheckCircle2 size={15}/>} description="Disponibilidade observada pelos probes desta sessão; não é um SLA global." />
        </section>

        {telemetry.acquirerLatencyMs !== null && telemetry.acquirerLatencyMs > DEGRADED_ACQUIRER_MS && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200"><TriangleAlert size={16} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Gargalo de adquirência detectado</p><p className="mt-1 text-[11px] text-amber-200/70">A latência observada ultrapassou {DEGRADED_ACQUIRER_MS} ms. Isso pode aumentar o tempo de checkout e merece investigação operacional.</p></div></div>
        )}

        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5">
          <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2"><Clock3 size={14} className="text-zinc-500"/><h2 className="text-sm font-semibold">Histórico de Latência</h2></div><p className="mt-1 text-[10px] text-zinc-600">Últimos probes realizados nesta sessão.</p></div><button type="button" disabled={refreshing} onClick={() => void refresh()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#191921] bg-[#060608] px-3 text-[10px] font-mono text-zinc-400 transition hover:text-white disabled:opacity-50">{refreshing ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>} ATUALIZAR</button></div>
          <div className="mt-4 overflow-hidden rounded-xl border border-[#191921] bg-[#060608]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-[#191921] px-4 py-2 text-[9px] font-mono uppercase tracking-wider text-zinc-600"><span>Sequência</span><span>Resposta</span><span>Status</span></div>
            {pings.length === 0 ? <div className="p-6 text-center text-[11px] text-zinc-600">Aguardando telemetria.</div> : pings.map((ping, index) => <div key={ping.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-[#191921]/60 px-4 py-2.5 text-[10px] font-mono last:border-0"><span className="text-zinc-500">PULSE_{String(index + 1).padStart(2, '0')} · {new Date(ping.at).toLocaleTimeString('pt-BR')}</span><span className={ping.latency > 300 ? 'font-semibold text-amber-400' : 'text-zinc-300'}>{ping.latency} ms</span><span className={ping.ok ? 'text-emerald-400' : 'text-rose-400'}>{ping.ok ? 'OK' : 'FALHA'}</span></div>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-600"><span>ÚLTIMA VARREDURA · {lastCheck}</span><span>{logs.length} logs transacionais carregados</span></div>
        </section>

        {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-300" role="alert">{error}</div>}
        {loading && <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-600"><Loader2 size={14} className="animate-spin"/> Inicializando telemetria…</div>}
      </main>
    </div>
  )
}

function Metric({ label, value, suffix, description }: { label: string; value: number | null; suffix: string; description: string }) {
  return <div className="rounded-xl border border-[#191921]/70 bg-[#060608] p-4"><span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span><div className="mt-2 flex items-baseline gap-1.5"><span className="text-3xl font-bold tracking-tight text-white">{value === null ? '—' : value}</span><span className="text-xs font-mono text-zinc-600">{suffix}</span></div><p className="mt-2 text-[10px] leading-relaxed text-zinc-600">{description}</p></div>
}

function MetricCard({ label, value, icon, description }: { label: string; value: string; icon: React.ReactNode; description: string }) {
  return <div className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-5"><div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">{icon}{label}</div><div className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</div><p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{description}</p></div>
}
