'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, Clock3, Cpu, Database, RefreshCw, Server, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface TelemetryMetrics {
  requestsPerSecond: number | null
  activeLocksCount: number | null
  postgresRetryCount: number | null
  averageLlmLatencyMs: number | null
  memoryHeapUsedMb: number | null
  completedRuns: number
  failedRuns: number
}
interface LiveRescueAlert { id: string; clientToken: string; productName: string; riskScore: number; strategy: string; timestamp: string }
type RunRow = { status: string; latency_ms: number | null; created_at: string; completed_at: string | null }
type EventRow = { id: string; status: string | null; created_at: string; processed_at: string | null; error_message: string | null }
type AlertRow = { id: string; client_id: string | null; product_id: string | null; risk_score: number | null; recommended_action: string | null; created_at: string; status: string | null }
const EMPTY_METRICS: TelemetryMetrics = { requestsPerSecond: null, activeLocksCount: null, postgresRetryCount: null, averageLlmLatencyMs: null, memoryHeapUsedMb: null, completedRuns: 0, failedRuns: 0 }
const formatNumber = (value: number | null, suffix = '') => value === null ? '—' : `${value.toLocaleString('pt-BR')}${suffix}`
const formatTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))

export default function IaraMetricsDashboard() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [metrics, setMetrics] = useState<TelemetryMetrics>(EMPTY_METRICS)
  const [alerts, setAlerts] = useState<LiveRescueAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [healthy, setHealthy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTelemetry = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) throw new Error('Sessão não autenticada.')
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [runsResult, eventsResult, alertsResult] = await Promise.all([
        db.from('iara_runs').select('status,latency_ms,created_at,completed_at').eq('user_id', auth.user.id).gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
        db.from('integration_events').select('id,status,created_at,processed_at,error_message').eq('user_id', auth.user.id).gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
        db.from('iara_proactive_alerts').select('id,client_id,product_id,risk_score,recommended_action,created_at,status').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(20),
      ])
      if (runsResult.error) throw new Error('Não foi possível carregar a observabilidade da IARA.')
      if (eventsResult.error) throw new Error('Não foi possível carregar a telemetria de infraestrutura.')
      const runs = (runsResult.data ?? []) as RunRow[]
      const events = (eventsResult.data ?? []) as EventRow[]
      const completed = runs.filter((run) => run.status === 'completed')
      const failed = runs.filter((run) => run.status === 'failed')
      const latencies = completed.map((run) => run.latency_ms).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      const averageLatency = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null
      const processingErrors = events.filter((event) => Boolean(event.error_message) || ['failed', 'error', 'timeout'].includes(String(event.status ?? '').toLowerCase())).length
      const retrySignals = events.filter((event) => /23505|retry|duplicate|conflict/i.test(`${event.error_message ?? ''} ${event.status ?? ''}`)).length
      const newestEvent = events[0]?.created_at ? new Date(events[0].created_at).getTime() : 0
      const oldestEventRow = events.length > 0 ? events[events.length - 1] : undefined
      const oldestEvent = oldestEventRow?.created_at ? new Date(oldestEventRow.created_at).getTime() : 0
      const observedSeconds = newestEvent && oldestEvent && newestEvent > oldestEvent ? Math.max(1, (newestEvent - oldestEvent) / 1000) : 0
      const requestsPerSecond = observedSeconds > 0 ? events.length / observedSeconds : null
      setMetrics({ requestsPerSecond, activeLocksCount: null, postgresRetryCount: retrySignals, averageLlmLatencyMs: averageLatency, memoryHeapUsedMb: null, completedRuns: completed.length, failedRuns: failed.length })
      setHealthy(failed.length === 0 && processingErrors === 0)
      if (!alertsResult.error) {
        const rows = (alertsResult.data ?? []) as AlertRow[]
        setAlerts(rows.map((row) => ({ id: row.id, clientToken: row.client_id ?? 'cliente não identificado', productName: row.product_id ?? 'produto não identificado', riskScore: Math.max(0, Math.min(100, Number(row.risk_score ?? 0))), strategy: row.recommended_action ?? 'OBSERVE', timestamp: formatTime(row.created_at) })))
      } else setAlerts([])
    } catch (cause) {
      setHealthy(false); setError(cause instanceof Error ? cause.message : 'Falha ao sincronizar telemetria.')
    } finally { setLoading(false); setRefreshing(false) }
  }, [db])
  useEffect(() => { void loadTelemetry() }, [loadTelemetry])
  useEffect(() => {
    const channel = db.channel('iara-telemetry-console').on('postgres_changes', { event: '*', schema: 'public', table: 'iara_runs' }, () => void loadTelemetry(true)).on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events' }, () => void loadTelemetry(true)).on('postgres_changes', { event: '*', schema: 'public', table: 'iara_proactive_alerts' }, () => void loadTelemetry(true)).subscribe()
    const interval = window.setInterval(() => void loadTelemetry(true), 30000)
    return () => { window.clearInterval(interval); void db.removeChannel(channel) }
  }, [db, loadTelemetry])
  const cards = [
    { label: 'Throughput observado', value: formatNumber(metrics.requestsPerSecond, ' req/s'), icon: Activity },
    { label: 'Locks ativos', value: formatNumber(metrics.activeLocksCount), icon: Database },
    { label: 'Colisões 23505', value: formatNumber(metrics.postgresRetryCount), icon: Zap },
    { label: 'Latência média IARA', value: formatNumber(metrics.averageLlmLatencyMs, ' ms'), icon: BrainCircuit },
    { label: 'Heap do processo', value: formatNumber(metrics.memoryHeapUsedMb, ' MB'), icon: Cpu },
  ]
  if (loading) return <section className="min-h-[calc(100dvh-5rem)] animate-pulse bg-[#060706] px-4 py-6 pb-32 text-white sm:px-6"><div className="mx-auto max-w-7xl space-y-5"><div className="h-16 rounded-2xl bg-white/[0.04]"/><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards.map((card) => <div key={card.label} className="h-28 rounded-2xl bg-white/[0.04]"/>)}</div><div className="h-96 rounded-2xl bg-white/[0.04]"/></div></section>
  return <section className="min-h-[calc(100dvh-5rem)] bg-[#060706] px-4 py-6 pb-32 text-white sm:px-6"><div className="mx-auto max-w-7xl space-y-5"><header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-[#090b0a]/95 px-4 py-3 backdrop-blur-md"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${healthy ? 'bg-[#1DBB54] animate-pulse' : 'bg-rose-500'}`} /><div><p className="text-xs font-bold tracking-[0.14em] text-zinc-100">IARA // CORE TELEMETRY</p><p className="mt-0.5 text-[9px] font-mono uppercase text-zinc-600">Observabilidade operacional baseada em dados reais</p></div></div><button type="button" onClick={() => void loadTelemetry(true)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.02] text-zinc-500" aria-label="Atualizar telemetria"><RefreshCw className={refreshing ? 'h-4 w-4 animate-spin text-[#1DBB54]' : 'h-4 w-4'} /></button></header>{error && <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-4"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"/><div><p className="text-xs font-semibold text-rose-300">Telemetria parcialmente indisponível</p><p className="mt-1 text-[11px] text-rose-200/60">{error}</p></div></div>}<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards.map(({ label, value, icon: Icon }) => <article key={label} className="rounded-2xl border border-white/[0.06] bg-[#0b0d0c] p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-mono uppercase tracking-wider text-zinc-600">{label}</span><Icon className="h-4 w-4 text-zinc-600"/></div><strong className="mt-3 block font-mono text-xl font-semibold text-zinc-100">{value}</strong></article>)}</div><div className="grid grid-cols-1 gap-5 lg:grid-cols-12"><article className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0b0d0c] lg:col-span-8"><div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3"><div><h2 className="text-xs font-bold text-zinc-200">Ações preditivas de resgate</h2><p className="mt-0.5 text-[9px] text-zinc-600">Alertas persistidos pelo motor da IARA.</p></div><span className="rounded border border-[#1DBB54]/20 bg-[#1DBB54]/10 px-2 py-1 text-[8px] font-mono text-[#1DBB54]">REALTIME</span></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead><tr className="border-b border-white/[0.04] text-[9px] font-mono uppercase tracking-wider text-zinc-600"><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Produto</th><th className="px-4 py-3 text-center">Risco</th><th className="px-4 py-3">Estratégia</th><th className="px-4 py-3 text-right">Hora</th></tr></thead><tbody className="divide-y divide-white/[0.04] text-[10px] font-mono">{alerts.length ? alerts.map((alert) => <tr key={alert.id} className="hover:bg-white/[0.015]"><td className="px-4 py-3 text-zinc-400">{alert.clientToken}</td><td className="px-4 py-3 font-sans text-zinc-200">{alert.productName}</td><td className="px-4 py-3 text-center"><span className={`rounded px-1.5 py-0.5 font-bold ${alert.riskScore >= 75 ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'}`}>{alert.riskScore}%</span></td><td className="px-4 py-3 text-zinc-400">{alert.strategy}</td><td className="px-4 py-3 text-right text-zinc-600">{alert.timestamp}</td></tr>) : <tr><td colSpan={5} className="px-4 py-12 text-center text-[10px] text-zinc-600">Nenhum alerta preditivo persistido no período atual.</td></tr>}</tbody></table></div></article><aside className="rounded-2xl border border-white/[0.06] bg-[#0b0d0c] p-4 lg:col-span-4"><div className="flex items-center gap-2"><Server className="h-4 w-4 text-[#1DBB54]"/><h2 className="text-xs font-bold text-zinc-200">Diagnóstico do núcleo</h2></div><div className="mt-4 space-y-3 text-[10px] font-mono">{[['Observabilidade IARA', metrics.completedRuns > 0 || metrics.failedRuns > 0], ['Latência de inferência', metrics.averageLlmLatencyMs !== null], ['Telemetria operacional', metrics.requestsPerSecond !== null], ['Alertas preditivos', alerts.length > 0]].map(([label, active]) => <div key={String(label)} className="flex items-center justify-between border-b border-white/[0.04] pb-3"><span className="text-zinc-500">{String(label)}</span>{active ? <CheckCircle2 className="h-4 w-4 text-[#1DBB54]"/> : <Clock3 className="h-4 w-4 text-zinc-700"/>}</div>)}</div><div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-xl bg-white/[0.025] p-3"><span className="block text-[8px] font-mono uppercase text-zinc-600">Execuções OK</span><strong className="mt-1 block font-mono text-lg">{metrics.completedRuns}</strong></div><div className="rounded-xl bg-white/[0.025] p-3"><span className="block text-[8px] font-mono uppercase text-zinc-600">Falhas</span><strong className={`mt-1 block font-mono text-lg ${metrics.failedRuns ? 'text-rose-400' : ''}`}>{metrics.failedRuns}</strong></div></div></aside></div></div></section>
}
