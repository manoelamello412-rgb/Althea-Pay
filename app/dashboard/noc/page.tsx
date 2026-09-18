'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  HeartPulse,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
  Webhook,
  Workflow,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type WindowMinutes = 15 | 60 | 360

type Metrics = {
  cron_active_jobs: number
  cron_failures: number
  api_requests: number
  api_5xx: number
  api_p95_ms: number
  integration_failures: number
  gateway_webhook_failures: number
  gateway_operation_failures: number
  gateway_avg_latency_ms: number
  automation_failures: number
  crm_outbox_failures: number
  outbound_webhook_failures: number
  reconciliation_exceptions: number
  recovery_failures: number
  command_failures: number
  readiness_passed: number
  readiness_required: number
  readiness_failed: number
  platform_health_failures: number
}

type QueueItem = { key: string; label: string; count: number; href: string }
type CronJob = {
  jobid: number
  jobname: string
  schedule: string
  active: boolean
  last_status: string | null
  last_start_at: string | null
  last_end_at: string | null
  last_duration_ms: number | null
}
type HealthCheck = { check_name: string; status: string; checked_at: string }
type ReadinessGate = { gate_name: string; required: boolean; status: string; updated_at: string }
type Incident = {
  severity: 'critical' | 'warning'
  source: string
  code: string
  title: string
  status: string
  occurred_at: string
  href: string
}
type Payload = {
  status: 'operational' | 'attention' | 'critical'
  metrics: Metrics
  queues: QueueItem[]
  cron_jobs: CronJob[]
  health_checks: HealthCheck[]
  readiness: ReadinessGate[]
  incidents: Incident[]
}

const EMPTY: Metrics = {
  cron_active_jobs: 0,
  cron_failures: 0,
  api_requests: 0,
  api_5xx: 0,
  api_p95_ms: 0,
  integration_failures: 0,
  gateway_webhook_failures: 0,
  gateway_operation_failures: 0,
  gateway_avg_latency_ms: 0,
  automation_failures: 0,
  crm_outbox_failures: 0,
  outbound_webhook_failures: 0,
  reconciliation_exceptions: 0,
  recovery_failures: 0,
  command_failures: 0,
  readiness_passed: 0,
  readiness_required: 0,
  readiness_failed: 0,
  platform_health_failures: 0,
}

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const dateTime = (value: unknown): string => {
  const parsed = new Date(typeof value === 'string' ? value : '')
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const stateMeta = {
  operational: {
    title: 'NOC operacional',
    description: 'Nenhuma falha crítica foi consolidada no período selecionado.',
    className: 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.055)] text-[#78d899]',
    icon: ShieldCheck,
  },
  attention: {
    title: 'NOC requer atenção',
    description: 'Existem falhas recuperáveis ou filas que merecem acompanhamento.',
    className: 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.055)] text-[#D4AF37]',
    icon: TriangleAlert,
  },
  critical: {
    title: 'NOC crítico',
    description: 'Há falhas de scheduler, comando, conciliação ou health que exigem ação.',
    className: 'border-red-400/15 bg-red-400/[.05] text-red-300',
    icon: AlertTriangle,
  },
} as const

function statusClass(status: string | null) {
  const value = (status || '').toLowerCase()
  if (['succeeded', 'success', 'pass', 'healthy', 'ok', 'operational'].includes(value)) {
    return 'text-[#78d899]'
  }
  if (['pending', 'running', 'processing', 'queued', 'retry'].includes(value)) {
    return 'text-[#D4AF37]'
  }
  if (['failed', 'error', 'critical', 'unhealthy', 'dead_letter'].includes(value)) {
    return 'text-red-300'
  }
  return 'text-[var(--althea-muted)]'
}

export default function NOCPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [minutes, setMinutes] = useState<WindowMinutes>(60)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await db.rpc('noc_operations_v1', { p_minutes: minutes })
      if (result.error) throw result.error
      const data = obj(result.data)
      const metrics = obj(data.metrics)
      setPayload({
        status: data.status === 'critical' || data.status === 'attention' ? data.status : 'operational',
        metrics: Object.fromEntries(Object.keys(EMPTY).map(key => [key, num(metrics[key])])) as unknown as Metrics,
        queues: Array.isArray(data.queues) ? data.queues as QueueItem[] : [],
        cron_jobs: Array.isArray(data.cron_jobs) ? data.cron_jobs as CronJob[] : [],
        health_checks: Array.isArray(data.health_checks) ? data.health_checks as HealthCheck[] : [],
        readiness: Array.isArray(data.readiness) ? data.readiness as ReadinessGate[] : [],
        incidents: Array.isArray(data.incidents) ? data.incidents as Incident[] : [],
      })
      setUpdatedAt(new Date().toISOString())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o NOC.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db, minutes])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    let active = true
    void db.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      setUserId(data.user.id)
      const profile = await db.from('profiles')
        .select('default_organization_id')
        .eq('id', data.user.id)
        .single()
      if (active && !profile.error && profile.data?.default_organization_id) {
        setOrganizationId(String(profile.data.default_organization_id))
      }
    })
    return () => { active = false }
  }, [db])

  useEffect(() => {
    const id = window.setInterval(() => void load(false), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!organizationId || !userId) return
    let timer: number | null = null
    const refresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load(false)
      }, 600)
    }

    const channel = db.channel(`noc-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_webhook_events', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recovery_events', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_command_targets', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reconciliation_items', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_executions', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_channel_message_outbox', filter: `user_id=eq.${userId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'api_request_logs', filter: `user_id=eq.${userId}` }, refresh)
      .subscribe()

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId, userId])

  const metrics = payload?.metrics ?? EMPTY
  const meta = stateMeta[payload?.status ?? 'operational']
  const StateIcon = meta.icon
  const readinessPercent = metrics.readiness_required > 0
    ? Math.round(metrics.readiness_passed / metrics.readiness_required * 100)
    : 0

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Network Operations Center</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">NOC / Observabilidade</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Saúde dos schedulers, filas, APIs, integrações, gateways, automações, Recovery, conciliação e readiness em uma única visão sanitizada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/[.055] bg-[var(--althea-surface)] p-1">
            {([15, 60, 360] as const).map(value => (
              <button key={value} type="button" onClick={() => setMinutes(value)} className={`rounded-lg px-3 py-2 text-[9px] font-semibold transition ${minutes === value ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
                {value < 60 ? `${value} min` : `${value / 60}h`}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(false)} disabled={refreshing} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.055] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white disabled:opacity-50" aria-label="Atualizar NOC">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">{error}</div>}

      <section className={`flex flex-col gap-4 rounded-2xl border p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between ${meta.className}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-current/10 bg-black/10"><StateIcon size={17} /></span>
          <div><h2 className="text-sm font-semibold">{loading ? 'Sincronizando NOC...' : meta.title}</h2><p className="mt-1 text-[10px] leading-4 opacity-75">{meta.description}</p></div>
        </div>
        <div className="text-[9px] opacity-75">Atualização automática a cada 30s · {updatedAt ? dateTime(updatedAt) : '—'}</div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <Metric icon={ServerCog} label="Schedulers" value={metrics.cron_active_jobs} />
        <Metric icon={AlertTriangle} label="Falhas cron" value={metrics.cron_failures} warning={metrics.cron_failures > 0} />
        <Metric icon={Activity} label="Requests API" value={metrics.api_requests} />
        <Metric icon={Gauge} label="API p95" value={`${metrics.api_p95_ms} ms`} warning={metrics.api_p95_ms > 1500} />
        <Metric icon={Webhook} label="Falhas integração" value={metrics.integration_failures + metrics.gateway_webhook_failures} warning={metrics.integration_failures + metrics.gateway_webhook_failures > 0} />
        <Metric icon={Workflow} label="Falhas automação" value={metrics.automation_failures} warning={metrics.automation_failures > 0} />
        <Metric icon={AlertTriangle} label="Reconciliação" value={metrics.reconciliation_exceptions} warning={metrics.reconciliation_exceptions > 0} />
        <Metric icon={CheckCircle2} label="Readiness" value={`${readinessPercent}%`} success={readinessPercent === 100} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.55fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Filas operacionais</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Itens ainda em processamento, retry ou exceção.</p></div>
            <Workflow size={16} className="text-[var(--althea-brand)]" />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(payload?.queues ?? []).map(queue => (
              <Link key={queue.key} href={queue.href} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 transition hover:border-white/[.09]">
                <div className="flex items-center justify-between gap-3"><span className="text-[9px] text-[var(--althea-muted)]">{queue.label}</span><ChevronRight size={11} className="text-[var(--althea-muted)]" /></div>
                <b className={`mt-2 block text-lg ${queue.count > 0 ? 'text-[#D4AF37]' : 'text-white'}`}>{queue.count}</b>
              </Link>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Production readiness</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Gates obrigatórios sem expor evidências internas.</p></div>
            <ShieldCheck size={16} className="text-[var(--althea-brand)]" />
          </div>
          <div className="mt-4">
            <div className="flex items-end justify-between"><b className="text-2xl text-white">{metrics.readiness_passed}/{metrics.readiness_required}</b><span className="text-[9px] text-[var(--althea-muted)]">{readinessPercent}%</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[.04]"><div className="h-full rounded-full bg-[var(--althea-brand)]/75" style={{ width: `${readinessPercent}%` }} /></div>
          </div>
          <div className="mt-4 max-h-[210px] space-y-1.5 overflow-y-auto pr-1">
            {(payload?.readiness ?? []).filter(gate => gate.required).map(gate => (
              <div key={gate.gate_name} className="flex items-center justify-between gap-3 rounded-lg border border-white/[.04] px-3 py-2">
                <span className="min-w-0 truncate text-[9px] text-zinc-300">{gate.gate_name}</span>
                <span className={`shrink-0 text-[8px] font-semibold uppercase ${statusClass(gate.status)}`}>{gate.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Schedulers</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Última execução dos jobs ativos. O comando SQL interno não é exposto.</p></div>
            <Clock3 size={16} className="text-[var(--althea-brand)]" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead><tr className="border-b border-white/[.045] text-[8px] uppercase tracking-wider text-[var(--althea-muted)]"><th className="pb-2.5">Job</th><th className="pb-2.5">Agenda</th><th className="pb-2.5">Status</th><th className="pb-2.5">Duração</th><th className="pb-2.5">Última execução</th></tr></thead>
              <tbody>{(payload?.cron_jobs ?? []).map(job => (
                <tr key={job.jobid} className="border-b border-white/[.03] last:border-0">
                  <td className="py-3 pr-3 text-[9px] font-semibold text-zinc-200">{job.jobname}</td>
                  <td className="py-3 pr-3 font-mono text-[8px] text-[var(--althea-muted)]">{job.schedule}</td>
                  <td className={`py-3 pr-3 text-[9px] font-semibold ${statusClass(job.last_status)}`}>{job.last_status || 'sem run'}</td>
                  <td className="py-3 pr-3 text-[9px] text-zinc-300">{job.last_duration_ms == null ? '—' : `${job.last_duration_ms} ms`}</td>
                  <td className="py-3 text-[9px] text-[var(--althea-muted)]">{dateTime(job.last_start_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Health checks</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Último estado persistido por check.</p></div>
            <HeartPulse size={16} className="text-[var(--althea-brand)]" />
          </div>
          <div className="mt-4 space-y-2">
            {(payload?.health_checks ?? []).length === 0 ? (
              <div className="grid min-h-[160px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] px-4 text-center">
                <div><HeartPulse size={19} className="mx-auto text-[var(--althea-muted)]" /><b className="mt-2 block text-[10px] text-zinc-300">Sem health checks persistidos</b><p className="mt-1 text-[9px] text-[var(--althea-muted)]">O NOC não considera ausência de check como sucesso.</p></div>
              </div>
            ) : (payload?.health_checks ?? []).map(check => (
              <div key={check.check_name} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                <div className="flex items-center justify-between gap-3"><b className="truncate text-[9px] text-zinc-300">{check.check_name}</b><span className={`text-[8px] font-semibold uppercase ${statusClass(check.status)}`}>{check.status}</span></div>
                <span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{dateTime(check.checked_at)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-sm font-semibold text-white">Incidentes recentes</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Eventos sanitizados; payloads e mensagens brutas não são enviados ao navegador.</p></div>
          <AlertTriangle size={16} className={(payload?.incidents ?? []).length ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} />
        </div>
        <div className="mt-4 space-y-2">
          {loading ? [1, 2, 3].map(item => <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--althea-bg)]" />) : (payload?.incidents ?? []).length === 0 ? (
            <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] text-center">
              <div><CheckCircle2 size={20} className="mx-auto text-[var(--althea-brand)]" /><b className="mt-2 block text-[10px] text-zinc-200">Sem incidentes no período</b></div>
            </div>
          ) : (payload?.incidents ?? []).map((incident, index) => (
            <Link key={`${incident.source}-${incident.code}-${incident.occurred_at}-${index}`} href={incident.href} className="flex items-center gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 hover:border-white/[.09]">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${incident.severity === 'critical' ? 'bg-red-400/[.07] text-red-300' : 'bg-[rgba(212,175,55,.07)] text-[#D4AF37]'}`}><AlertTriangle size={13} /></span>
              <div className="min-w-0 flex-1"><b className="block truncate text-[10px] text-zinc-200">{incident.title}</b><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{incident.source} · {incident.status} · {dateTime(incident.occurred_at)}</span></div>
              <ChevronRight size={12} className="shrink-0 text-[var(--althea-muted)]" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function Metric({ icon: Icon, label, value, warning = false, success = false }: {
  icon: typeof Activity
  label: string
  value: string | number
  warning?: boolean
  success?: boolean
}) {
  return (
    <article className="min-h-[108px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-start justify-between gap-2"><span className="text-[9px] text-[var(--althea-muted)]">{label}</span><Icon size={14} className={warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-[#718079]'} /></div>
      <b className={`mt-4 block text-[20px] ${warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-white'}`}>{value}</b>
    </article>
  )
}
