'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CreditCard,
  GitBranch,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Router,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type WindowHours = 6 | 24 | 72

type Metrics = {
  live_sessions: number
  identified_live_sessions: number
  payment_transactions: number
  approved_payments: number
  pending_payments: number
  failed_payments: number
  approved_volume: number
  checkout_count: number
  completed_checkouts: number
  abandoned_checkouts: number
  recovery_in_progress: number
  recovery_blocked: number
  recovery_failed: number
  recovered_checkouts: number
  crm_open: number
  crm_unread: number
  crm_sla_overdue: number
  funnels: number
  active_connections: number
  controllable_funnels: number
  connection_errors: number
  gateways: number
  operational_gateways: number
  open_drifts: number
  active_command_batches: number
  failed_command_targets: number
  integration_events: number
  integration_errors: number
  payment_approval_rate: number
}

type AttentionItem = {
  severity: 'critical' | 'warning' | 'info'
  code: string
  title: string
  message: string
  count: number
  href: string
}

type CommandItem = {
  id: string
  correlation_id: string
  command_type: string
  status: string
  target_gateway_id: string | null
  target_gateway_name: string | null
  dry_run: boolean
  total_targets: number
  succeeded_targets: number
  failed_targets: number
  pending_targets: number
  requested_at: string
  completed_at: string | null
}

type Payload = {
  status: 'operational' | 'attention' | 'critical'
  metrics: Metrics
  attention: AttentionItem[]
  recent_commands: CommandItem[]
}

const EMPTY_METRICS: Metrics = {
  live_sessions: 0,
  identified_live_sessions: 0,
  payment_transactions: 0,
  approved_payments: 0,
  pending_payments: 0,
  failed_payments: 0,
  approved_volume: 0,
  checkout_count: 0,
  completed_checkouts: 0,
  abandoned_checkouts: 0,
  recovery_in_progress: 0,
  recovery_blocked: 0,
  recovery_failed: 0,
  recovered_checkouts: 0,
  crm_open: 0,
  crm_unread: 0,
  crm_sla_overdue: 0,
  funnels: 0,
  active_connections: 0,
  controllable_funnels: 0,
  connection_errors: 0,
  gateways: 0,
  operational_gateways: 0,
  open_drifts: 0,
  active_command_batches: 0,
  failed_command_targets: 0,
  integration_events: 0,
  integration_errors: 0,
  payment_approval_rate: 0,
}

const objectOf = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const numberOf = (value: unknown): number => {
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

const money = (value: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberOf(value))

const statusMeta = {
  operational: {
    label: 'Operação estável',
    description: 'Nenhum alerta crítico consolidado no Control Plane.',
    className: 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.055)] text-[#78d899]',
    icon: CheckCircle2,
  },
  attention: {
    label: 'Requer atenção',
    description: 'Existem bloqueios ou divergências que merecem revisão operacional.',
    className: 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.055)] text-[#D4AF37]',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Ação necessária',
    description: 'Há falhas de comando ou conexão que podem afetar o controle da operação.',
    className: 'border-red-400/15 bg-red-400/[.05] text-red-300',
    icon: AlertTriangle,
  },
} as const

const commandLabels: Record<string, string> = {
  queued: 'Na fila',
  running: 'Executando',
  succeeded: 'Concluído',
  partial: 'Parcial',
  failed: 'Falhou',
  preflight_failed: 'Preflight bloqueado',
  cancelled: 'Cancelado',
}

function commandClass(status: string) {
  if (status === 'succeeded') return 'text-[#78d899]'
  if (['failed', 'preflight_failed'].includes(status)) return 'text-red-300'
  if (status === 'partial') return 'text-[#D4AF37]'
  return 'text-zinc-300'
}

export function CommandCenterOperations() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [hours, setHours] = useState<WindowHours>(24)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await db.rpc('command_center_operations_v1', { p_hours: hours })
      if (result.error) throw result.error
      const data = objectOf(result.data)
      const metrics = objectOf(data.metrics)
      setPayload({
        status: data.status === 'critical' || data.status === 'attention' ? data.status : 'operational',
        metrics: Object.fromEntries(
          Object.keys(EMPTY_METRICS).map(key => [key, numberOf(metrics[key])]),
        ) as unknown as Metrics,
        attention: Array.isArray(data.attention) ? data.attention as AttentionItem[] : [],
        recent_commands: Array.isArray(data.recent_commands) ? data.recent_commands as CommandItem[] : [],
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o Command Center.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db, hours])

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
    if (!organizationId || !userId) return
    let timer: number | null = null
    const queueRefresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load(false)
      }, 600)
    }

    const channel = db.channel(`command-center-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attribution_sessions', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_command_batches', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_command_targets', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_control_drift_events', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integration_events', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations', filter: `user_id=eq.${userId}` }, queueRefresh)
      .subscribe()

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId, userId])

  const metrics = payload?.metrics ?? EMPTY_METRICS
  const state = statusMeta[payload?.status ?? 'operational']
  const StatusIcon = state.icon
  const attention = payload?.attention ?? []
  const commands = payload?.recent_commands ?? []

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--althea-brand)]">
            <Activity size={13} /> Command Center
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-[-.025em] text-white">Operação agora</h2>
          <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Sinais do Control Plane consolidados no servidor, independentes dos filtros financeiros abaixo.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-white/[.055] bg-[var(--althea-surface)] p-1">
            {([6, 24, 72] as const).map(value => (
              <button key={value} type="button" onClick={() => setHours(value)} className={`rounded-lg px-2.5 py-1.5 text-[9px] font-semibold transition ${hours === value ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
                {value}h
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(false)} disabled={refreshing} className="grid h-9 w-9 place-items-center rounded-xl border border-white/[.055] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white disabled:opacity-50" aria-label="Atualizar Command Center">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-[10px] text-red-200">{error}</div>}

      <div className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${state.className}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-current/10 bg-black/10"><StatusIcon size={16} /></span>
          <div><b className="block text-xs">{loading ? 'Sincronizando operação...' : state.label}</b><p className="mt-1 text-[9px] leading-4 opacity-75">{state.description}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 text-[8px] font-semibold uppercase tracking-wider opacity-80">
          <span>{metrics.integration_events} eventos / {hours}h</span>
          <span>·</span>
          <span>{metrics.active_command_batches} batch(es) ativo(s)</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Signal href="/dashboard/funil/live" icon={Users} label="Sessões ao vivo" value={metrics.live_sessions} note={`${metrics.identified_live_sessions} identificadas`} />
        <Signal href="/dashboard/pagamentos" icon={CreditCard} label="Pagamentos pendentes" value={metrics.pending_payments} note={`${metrics.payment_approval_rate.toFixed(1).replace('.', ',')}% aprovação`} warning={metrics.pending_payments > 0} />
        <Signal href="/dashboard/crm" icon={MessageCircle} label="CRM não lido" value={metrics.crm_unread} note={`${metrics.crm_open} abertas · ${metrics.crm_sla_overdue} SLA vencido`} warning={metrics.crm_sla_overdue > 0} />
        <Signal href="/dashboard/recovery" icon={RotateCcw} label="Recovery em operação" value={metrics.recovery_in_progress} note={`${metrics.recovered_checkouts} recuperados`} warning={metrics.recovery_failed > 0} />
        <Signal href="/dashboard/routing" icon={Router} label="Drifts abertos" value={metrics.open_drifts} note={`${metrics.controllable_funnels}/${metrics.funnels} funis controláveis`} warning={metrics.open_drifts > 0} />
        <Signal href="/dashboard/routing" icon={CircleDot} label="Command batches" value={metrics.active_command_batches} note={`${metrics.failed_command_targets} target(s) com falha`} warning={metrics.failed_command_targets > 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h3 className="text-sm font-semibold text-white">Atenção operacional</h3><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Somente condições reais detectadas no backend.</p></div>
            <AlertTriangle size={16} className={attention.length ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} />
          </div>

          <div className="mt-4 space-y-2">
            {loading ? (
              [1, 2, 3].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)
            ) : attention.length === 0 ? (
              <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] px-5 text-center">
                <div><ShieldCheck size={20} className="mx-auto text-[var(--althea-brand)]" /><b className="mt-2 block text-[10px] text-zinc-200">Nenhum alerta consolidado</b><p className="mt-1 text-[9px] text-[var(--althea-muted)]">O Control Plane não encontrou bloqueios ou falhas que exijam ação agora.</p></div>
              </div>
            ) : attention.map(item => (
              <Link key={item.code} href={item.href} className="flex items-center gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 transition hover:border-white/[.09]">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.severity === 'critical' ? 'bg-red-400/[.07] text-red-300' : item.severity === 'warning' ? 'bg-[rgba(212,175,55,.07)] text-[#D4AF37]' : 'bg-white/[.04] text-zinc-300'}`}>
                  <AlertTriangle size={13} />
                </span>
                <div className="min-w-0 flex-1"><b className="block truncate text-[10px] text-zinc-200">{item.title}</b><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[var(--althea-muted)]">{item.message}</p></div>
                <span className="shrink-0 text-[9px] font-semibold text-zinc-300">{item.count}</span>
                <ChevronRight size={12} className="shrink-0 text-[var(--althea-muted)]" />
              </Link>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h3 className="text-sm font-semibold text-white">Prontidão do Control Plane</h3><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Cobertura operacional observada.</p></div>
            <GitBranch size={16} className="text-[var(--althea-brand)]" />
          </div>
          <div className="mt-4 space-y-2">
            <Readiness label="Gateways operacionais" value={metrics.operational_gateways} total={metrics.gateways} href="/dashboard/gateways" />
            <Readiness label="Funis controláveis" value={metrics.controllable_funnels} total={metrics.funnels} href="/dashboard/routing" />
            <Readiness label="Conexões ativas" value={metrics.active_connections} total={metrics.funnels} href="/dashboard/routing" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Mini label="Volume aprovado" value={money(metrics.approved_volume)} />
            <Mini label="Aprovação" value={`${metrics.payment_approval_rate.toFixed(1).replace('.', ',')}%`} />
            <Mini label="Abandonos" value={String(metrics.abandoned_checkouts)} />
            <Mini label="Integrações em erro" value={String(metrics.integration_errors)} warning={metrics.integration_errors > 0} />
          </div>
        </article>
      </div>

      {commands.length > 0 && (
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div><h3 className="text-sm font-semibold text-white">Últimos Commands</h3><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Batches persistentes do Control Plane.</p></div>
            <Link href="/dashboard/routing" className="text-[9px] font-semibold text-[var(--althea-brand)]">Abrir histórico</Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead><tr className="border-b border-white/[.045] text-[8px] uppercase tracking-wider text-[var(--althea-muted)]"><th className="pb-2.5">Batch</th><th className="pb-2.5">Gateway</th><th className="pb-2.5">Tipo</th><th className="pb-2.5">Status</th><th className="pb-2.5">Targets</th><th className="pb-2.5">Solicitado</th></tr></thead>
              <tbody>{commands.map(command => (
                <tr key={command.id} className="border-b border-white/[.03] last:border-0">
                  <td className="py-3 pr-3 font-mono text-[9px] text-zinc-300">{command.correlation_id}</td>
                  <td className="py-3 pr-3 text-[9px] text-zinc-300">{command.target_gateway_name || 'Rollback'}</td>
                  <td className="py-3 pr-3 text-[9px] text-[var(--althea-muted)]">{command.dry_run ? 'Preflight' : command.command_type === 'gateway_rollback' ? 'Rollback' : 'Execução'}</td>
                  <td className={`py-3 pr-3 text-[9px] font-semibold ${commandClass(command.status)}`}>{commandLabels[command.status] || command.status}</td>
                  <td className="py-3 pr-3 text-[9px] text-zinc-300">{command.succeeded_targets}/{command.total_targets} <span className="text-[var(--althea-muted)]">· {command.failed_targets} falha(s)</span></td>
                  <td className="py-3 text-[9px] text-[var(--althea-muted)]">{dateTime(command.requested_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  )
}

function Signal({ href, icon: Icon, label, value, note, warning = false }: {
  href: string
  icon: typeof Activity
  label: string
  value: number
  note: string
  warning?: boolean
}) {
  return (
    <Link href={href} className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 transition hover:-translate-y-0.5 hover:border-white/[.1]">
      <div className="flex items-start justify-between gap-3"><span className="text-[9px] text-[var(--althea-muted)]">{label}</span><Icon size={14} className={warning ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} /></div>
      <b className={`mt-3 block text-[22px] font-semibold ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}</b>
      <span className="mt-1 block text-[8px] leading-4 text-[var(--althea-muted)]">{note}</span>
    </Link>
  )
}

function Readiness({ label, value, total, href }: { label: string; value: number; total: number; href: string }) {
  const ratio = total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0
  return (
    <Link href={href} className="block rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
      <div className="flex items-center justify-between gap-3"><span className="text-[9px] text-[var(--althea-muted)]">{label}</span><b className="text-[9px] text-zinc-200">{value}/{total}</b></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.04]"><div className="h-full rounded-full bg-[var(--althea-brand)]/70" style={{ width: `${ratio}%` }} /></div>
    </Link>
  )
}

function Mini({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3"><span className="text-[8px] text-[var(--althea-muted)]">{label}</span><b className={`mt-1 block text-[10px] ${warning ? 'text-[#D4AF37]' : 'text-zinc-200'}`}>{value}</b></div>
}
