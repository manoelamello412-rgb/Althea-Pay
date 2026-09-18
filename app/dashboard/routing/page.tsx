'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Network,
  RefreshCw,
  RotateCcw,
  Router,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Metrics = {
  gateways: number
  operational_gateways: number
  funnels: number
  controllable_funnels: number
  active_drifts: number
  running_batches: number
}
type Gateway = {
  id: string
  name: string
  provider: string | null
  environment: string | null
  status: string
  mapped_funnels: number
  primary_funnels: number
}
type Mapping = {
  gateway_id: string
  gateway_name: string
  remote_gateway_ref: string
  status: string
}
type Connection = {
  id: string
  funnel_id: string | null
  funnel_name: string | null
  status: string
  health_status: string | null
  control_status: string
  write_enabled: boolean
  capabilities: string[] | Json
  desired_gateway_id: string | null
  desired_gateway_name: string | null
  observed_gateway_id: string | null
  observed_gateway_name: string | null
  last_verified_at: string | null
  last_command_at: string | null
  last_error: string | null
  mappings: Mapping[]
}
type Target = {
  id: string
  funnel_id: string
  funnel_name: string | null
  status: string
  attempt_count: number
  max_attempts: number
  target_gateway_id: string
  target_gateway_name: string | null
  previous_gateway_id: string | null
  previous_gateway_name: string | null
  target_remote_gateway_ref: string | null
  previous_remote_gateway_ref: string | null
  last_error_code: string | null
  last_error_message: string | null
  started_at: string | null
  verified_at: string | null
  completed_at: string | null
  updated_at: string
}
type Batch = {
  id: string
  correlation_id: string
  command_type: string
  target_gateway_id: string | null
  target_gateway_name: string | null
  dry_run: boolean
  allow_partial: boolean
  status: string
  phase: string
  total_targets: number
  succeeded_targets: number
  failed_targets: number
  pending_targets: number
  requested_at: string
  started_at: string | null
  completed_at: string | null
  rollback_of: string | null
  targets: Target[]
}
type Drift = {
  id: string
  connection_id: string
  funnel_id: string
  funnel_name: string | null
  expected_gateway_id: string | null
  expected_gateway_name: string | null
  observed_gateway_id: string | null
  observed_gateway_name: string | null
  observed_remote_gateway_ref: string | null
  status: string
  correlation_id: string
  details: Json
  detected_at: string
  last_seen_at: string
  resolved_at: string | null
}
type Payload = {
  metrics: Metrics
  gateways: Gateway[]
  connections: Connection[]
  batches: Batch[]
  drifts: Drift[]
}

const EMPTY_METRICS: Metrics = {
  gateways: 0,
  operational_gateways: 0,
  funnels: 0,
  controllable_funnels: 0,
  active_drifts: 0,
  running_batches: 0,
}

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value)

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const dateTime = (value: unknown): string => {
  const parsed = new Date(text(value))
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const batchLabels: Record<string, string> = {
  queued: 'Na fila',
  running: 'Executando',
  succeeded: 'Concluído',
  partial: 'Parcial',
  failed: 'Falhou',
  preflight_failed: 'Preflight bloqueado',
  cancelled: 'Cancelado',
}

const targetLabels: Record<string, string> = {
  queued: 'Na fila',
  running: 'Executando',
  retry: 'Retry',
  preflight_succeeded: 'Preflight OK',
  verified: 'Verificado',
  failed: 'Falhou',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
}

function statusClass(status: string) {
  if (['succeeded', 'verified', 'preflight_succeeded', 'ready', 'healthy'].includes(status)) {
    return 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.07)] text-[#7bdc9b]'
  }
  if (['failed', 'preflight_failed', 'blocked', 'error', 'open'].includes(status)) {
    return 'border-red-400/15 bg-red-400/[.055] text-red-300'
  }
  if (['partial', 'degraded', 'retry'].includes(status)) {
    return 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.06)] text-[#D4AF37]'
  }
  return 'border-white/[.06] bg-white/[.025] text-zinc-300'
}

export default function RoutingPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payload, setPayload] = useState<Payload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [selectedGatewayId, setSelectedGatewayId] = useState('')
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [working, setWorking] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await db.rpc('gateway_control_center_v1', { p_limit: 30 })
      if (result.error) throw result.error
      const data = obj(result.data)
      const metrics = obj(data.metrics)
      const next: Payload = {
        metrics: {
          gateways: num(metrics.gateways),
          operational_gateways: num(metrics.operational_gateways),
          funnels: num(metrics.funnels),
          controllable_funnels: num(metrics.controllable_funnels),
          active_drifts: num(metrics.active_drifts),
          running_batches: num(metrics.running_batches),
        },
        gateways: Array.isArray(data.gateways) ? data.gateways as Gateway[] : [],
        connections: Array.isArray(data.connections) ? data.connections as Connection[] : [],
        batches: Array.isArray(data.batches) ? data.batches as Batch[] : [],
        drifts: Array.isArray(data.drifts) ? data.drifts as Drift[] : [],
      }
      setPayload(next)
      setSelectedGatewayId(current => {
        if (current && next.gateways.some(gateway => gateway.id === current)) return current
        return next.gateways.find(gateway => ['connected', 'degraded'].includes(gateway.status.toLowerCase()))?.id ?? ''
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a Central de Roteamento.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    let active = true
    void db.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
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
    if (!organizationId) return
    let timer: number | null = null
    const refresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load(false)
      }, 450)
    }
    const channel = db.channel(`gateway-control-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_command_batches', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_command_targets', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_control_drift_events', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_connections', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId])

  const selectedGateway = payload?.gateways.find(gateway => gateway.id === selectedGatewayId) ?? null
  const latestSuccessfulPreflight = payload?.batches.find(batch =>
    batch.command_type === 'gateway_switch' &&
    batch.dry_run &&
    batch.target_gateway_id === selectedGatewayId &&
    batch.status === 'succeeded'
  ) ?? null

  const invokeWorker = async (batchId: string) => {
    const result = await db.functions.invoke('funnel-command-worker', {
      body: { batch_id: batchId, limit: 50 },
    })
    if (result.error) throw new Error(result.error.message)
    if (result.data?.ok !== true) throw new Error(result.data?.error || 'Command worker falhou.')
    return result.data
  }

  const requestSwitch = async (dryRun: boolean) => {
    if (!selectedGateway || working) return
    setWorking(dryRun ? 'preflight' : 'execute')
    setError('')
    setMessage('')
    try {
      const result = await db.rpc('request_global_funnel_gateway_switch', {
        p_gateway_id: selectedGateway.id,
        p_dry_run: dryRun,
        p_allow_partial: false,
        p_idempotency_key: `${dryRun ? 'preflight' : 'switch'}:${selectedGateway.id}:${crypto.randomUUID()}`,
      })
      if (result.error) throw result.error

      const requested = obj(result.data)
      const batchId = text(requested.batch_id)
      if (!batchId) throw new Error('O Command Engine não retornou batch_id.')

      if (['failed', 'preflight_failed'].includes(text(requested.status))) {
        await load(false)
        setExpandedBatchId(batchId)
        throw new Error('Preflight bloqueado. Abra o batch para ver os funis que precisam de correção.')
      }

      const worker = await invokeWorker(batchId)
      const batch = obj(worker.batch)
      const status = text(batch.status)
      await load(false)
      setExpandedBatchId(batchId)

      if (dryRun) {
        if (status === 'succeeded') {
          setMessage(`Preflight concluído para ${selectedGateway.name}. Todos os targets elegíveis foram verificados antes de qualquer alteração remota.`)
        } else {
          setMessage(`Preflight ${text(batch.correlation_id) || batchId} está em ${status || 'processamento'}. O worker continuará os retries automaticamente.`)
        }
      } else if (status === 'succeeded') {
        setMessage(`Troca global confirmada: ${num(batch.succeeded_targets)}/${num(batch.total_targets)} funis foram verificados remotamente antes da atualização local.`)
      } else if (['failed', 'partial', 'preflight_failed'].includes(status)) {
        throw new Error(`Operação terminou como ${batchLabels[status] || status}. Nenhum target não verificado é contado como sucesso.`)
      } else {
        setMessage(`Operação ${text(batch.correlation_id) || batchId} continua em processamento pelo worker automático.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao executar o comando de gateway.')
    } finally {
      setWorking('')
    }
  }

  const rollback = async (batch: Batch) => {
    if (working) return
    setWorking(`rollback:${batch.id}`)
    setError('')
    setMessage('')
    try {
      const result = await db.rpc('request_funnel_gateway_rollback', {
        p_batch_id: batch.id,
        p_allow_partial: false,
        p_idempotency_key: `rollback:${batch.id}:${crypto.randomUUID()}`,
      })
      if (result.error) throw result.error
      const requested = obj(result.data)
      const rollbackBatchId = text(requested.batch_id)
      if (!rollbackBatchId) throw new Error('O rollback não retornou batch_id.')
      if (['failed', 'preflight_failed'].includes(text(requested.status))) {
        await load(false)
        setExpandedBatchId(rollbackBatchId)
        throw new Error('Rollback bloqueado porque o estado anterior não é verificável em todos os targets.')
      }

      const worker = await invokeWorker(rollbackBatchId)
      const finalBatch = obj(worker.batch)
      await load(false)
      setExpandedBatchId(rollbackBatchId)

      if (text(finalBatch.status) === 'succeeded') {
        setMessage(`Rollback confirmado em ${num(finalBatch.succeeded_targets)}/${num(finalBatch.total_targets)} funis.`)
      } else {
        setMessage(`Rollback ${text(finalBatch.correlation_id) || rollbackBatchId} está em ${text(finalBatch.status) || 'processamento'}.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao solicitar rollback.')
    } finally {
      setWorking('')
    }
  }

  const metrics = payload?.metrics ?? EMPTY_METRICS
  const executeEnabled = Boolean(selectedGateway && latestSuccessfulPreflight && !working)

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Control plane</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Roteamento & Commands</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Preflight, troca remota, verificação, retries, drift e rollback em um único histórico persistente. O vínculo interno só muda depois da confirmação externa.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/gateways" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] hover:text-white">
            <Network size={13} /> Conexões
          </Link>
          <button type="button" onClick={() => void load(false)} disabled={refreshing} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white disabled:opacity-50" aria-label="Atualizar">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>

      {message && <div className="flex items-center gap-2 rounded-xl border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.05)] px-4 py-3 text-xs text-[var(--althea-brand)]"><CheckCircle2 size={14} />{message}</div>}
      {error && <div className="flex items-center gap-2 rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200"><AlertTriangle size={14} />{error}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric icon={Network} label="Gateways" value={metrics.gateways} />
        <Metric icon={ShieldCheck} label="Operacionais" value={metrics.operational_gateways} success />
        <Metric icon={Router} label="Funis" value={metrics.funnels} />
        <Metric icon={Zap} label="Controláveis" value={metrics.controllable_funnels} success={metrics.controllable_funnels === metrics.funnels && metrics.funnels > 0} />
        <Metric icon={AlertTriangle} label="Drifts abertos" value={metrics.active_drifts} warning={metrics.active_drifts > 0} />
        <Metric icon={CircleDot} label="Batches ativos" value={metrics.running_batches} warning={metrics.running_batches > 0} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-sm font-semibold text-white">Comando global de gateway</h2><p className="mt-1 text-[10px] leading-5 text-[var(--althea-muted)]">O preflight é obrigatório antes de habilitar a execução nesta sessão.</p></div>
            <Router size={17} className="text-[var(--althea-brand)]" />
          </div>

          <label className="mt-5 block">
            <span className="text-[9px] uppercase tracking-wider text-[var(--althea-muted)]">Gateway alvo</span>
            <select value={selectedGatewayId} onChange={event => setSelectedGatewayId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/[.06] bg-[var(--althea-bg)] px-3 text-xs text-white outline-none">
              <option value="">Selecione...</option>
              {(payload?.gateways ?? []).map(gateway => <option key={gateway.id} value={gateway.id} disabled={!['connected', 'degraded'].includes(gateway.status.toLowerCase())}>{gateway.name} · {gateway.status}</option>)}
            </select>
          </label>

          {selectedGateway && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Mini label="Provider" value={selectedGateway.provider || '—'} />
              <Mini label="Mapeado em" value={`${selectedGateway.mapped_funnels} funil(is)`} />
              <Mini label="Primário hoje" value={`${selectedGateway.primary_funnels} funil(is)`} />
            </div>
          )}

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void requestSwitch(true)} disabled={!selectedGateway || Boolean(working)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[.07] bg-white/[.02] px-4 text-[10px] font-semibold text-zinc-200 hover:bg-white/[.04] disabled:opacity-40">
              {working === 'preflight' ? <RefreshCw size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Executar preflight
            </button>
            <button type="button" onClick={() => void requestSwitch(false)} disabled={!executeEnabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.07)] px-4 text-[10px] font-semibold text-[var(--althea-brand)] disabled:cursor-not-allowed disabled:opacity-35">
              {working === 'execute' ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />} Aplicar em todos os funis
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 text-[9px] leading-4 text-[var(--althea-muted)]">
            {latestSuccessfulPreflight
              ? <>Preflight persistente encontrado: <b className="text-zinc-300">{latestSuccessfulPreflight.correlation_id}</b>, concluído em {dateTime(latestSuccessfulPreflight.completed_at)}. A execução ainda cria um novo batch e repete o preflight antes de alterar o remoto.</>
              : 'A execução permanece bloqueada até existir um preflight concluído para o gateway selecionado.'}
          </div>
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">Prontidão dos funis</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Estado observado do controle remoto.</p></div><ShieldCheck size={17} className="text-[var(--althea-brand)]" /></div>
          <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {loading ? <Skeleton rows={4} /> : (payload?.connections ?? []).length === 0 ? <Empty text="Nenhuma conexão de funil." /> : (payload?.connections ?? []).map(connection => {
              const capabilities = Array.isArray(connection.capabilities) ? connection.capabilities.map(String) : []
              const ready = connection.status === 'active' && connection.write_enabled && ['ready', 'degraded'].includes(connection.control_status) && capabilities.includes('gateway:read') && capabilities.includes('gateway:write')
              return <div key={connection.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                <div className="flex items-center justify-between gap-3"><b className="truncate text-[10px] text-zinc-200">{connection.funnel_name || connection.funnel_id || 'Funil'}</b><Badge status={ready ? 'ready' : connection.control_status} /></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[var(--althea-muted)]"><span>Desejado: {connection.desired_gateway_name || '—'}</span><span>Observado: {connection.observed_gateway_name || '—'}</span><span>Mappings: {connection.mappings?.length ?? 0}</span><span>Verificado: {dateTime(connection.last_verified_at)}</span></div>
                {connection.last_error && <p className="mt-2 truncate text-[8px] text-red-300" title={connection.last_error}>{connection.last_error}</p>}
              </div>
            })}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold text-white">Histórico de Commands</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Cada batch permanece auditável depois que a sessão do navegador termina.</p></div><CircleDot size={17} className="text-[var(--althea-brand)]" /></div>
        <div className="mt-4 space-y-2">
          {loading ? <Skeleton rows={5} /> : (payload?.batches ?? []).length === 0 ? <Empty text="Nenhum command batch registrado." /> : (payload?.batches ?? []).map(batch => {
            const expanded = expandedBatchId === batch.id
            const rollbackable = batch.command_type === 'gateway_switch' && !batch.dry_run && ['succeeded', 'partial'].includes(batch.status)
            return <article key={batch.id} className="overflow-hidden rounded-xl border border-white/[.05] bg-[var(--althea-bg)]">
              <button type="button" onClick={() => setExpandedBatchId(expanded ? null : batch.id)} className="grid w-full gap-3 p-3.5 text-left lg:grid-cols-[minmax(180px,1.2fr)_160px_120px_160px_120px_24px] lg:items-center">
                <div className="min-w-0"><b className="block truncate text-[10px] text-zinc-200">{batch.command_type === 'gateway_rollback' ? 'Rollback' : batch.dry_run ? 'Preflight global' : 'Troca global'} · {batch.target_gateway_name || batch.target_gateway_id || 'gateway anterior'}</b><span className="mt-1 block truncate font-mono text-[8px] text-[var(--althea-muted)]">{batch.correlation_id}</span></div>
                <Badge status={batch.status} />
                <span className="text-[9px] text-[var(--althea-muted)]">{batch.succeeded_targets}/{batch.total_targets} OK</span>
                <span className="text-[9px] text-[var(--althea-muted)]">{dateTime(batch.requested_at)}</span>
                <span className="text-[9px] text-[var(--althea-muted)]">{batch.phase}</span>
                {expanded ? <ChevronDown size={14} className="text-[var(--althea-muted)]" /> : <ChevronRight size={14} className="text-[var(--althea-muted)]" />}
              </button>
              {expanded && <div className="border-t border-white/[.045] p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2 text-[8px] text-[var(--althea-muted)]"><span>{batch.failed_targets} falha(s)</span><span>{batch.pending_targets} pendente(s)</span><span>{batch.allow_partial ? 'parcial permitido' : 'all-or-block'}</span></div>
                  {rollbackable && <button type="button" onClick={() => void rollback(batch)} disabled={Boolean(working)} className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,.16)] bg-[rgba(212,175,55,.05)] px-3 py-2 text-[9px] font-semibold text-[#D4AF37] disabled:opacity-40">{working === `rollback:${batch.id}` ? <RefreshCw size={11} className="animate-spin" /> : <RotateCcw size={11} />} Rollback verificado</button>}
                </div>
                <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left">
                  <thead><tr className="border-b border-white/[.045] text-[8px] uppercase tracking-wider text-[var(--althea-muted)]"><th className="pb-2 pr-3">Funil</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Anterior</th><th className="pb-2 pr-3">Alvo</th><th className="pb-2 pr-3">Remoto</th><th className="pb-2 pr-3">Tentativas</th><th className="pb-2">Diagnóstico</th></tr></thead>
                  <tbody>{(batch.targets ?? []).map(target => <tr key={target.id} className="border-b border-white/[.03] last:border-0"><td className="py-2.5 pr-3 text-[9px] text-zinc-300">{target.funnel_name || target.funnel_id}</td><td className="py-2.5 pr-3"><Badge status={target.status} target /></td><td className="py-2.5 pr-3 text-[9px] text-[var(--althea-muted)]">{target.previous_gateway_name || target.previous_gateway_id || '—'}</td><td className="py-2.5 pr-3 text-[9px] text-zinc-300">{target.target_gateway_name || target.target_gateway_id}</td><td className="py-2.5 pr-3 font-mono text-[8px] text-[var(--althea-muted)]">{target.target_remote_gateway_ref || '—'}</td><td className="py-2.5 pr-3 text-[9px] text-[var(--althea-muted)]">{target.attempt_count}/{target.max_attempts}</td><td className={`py-2.5 text-[9px] ${target.last_error_message ? 'text-red-300' : 'text-[var(--althea-muted)]'}`}>{target.last_error_message || 'sem erro'}</td></tr>)}</tbody>
                </table></div>
              </div>}
            </article>
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold text-white">Drift remoto</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Divergências detectadas entre o estado desejado e o observado fora da Althea.</p></div><AlertTriangle size={17} className={metrics.active_drifts > 0 ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} /></div>
        <div className="mt-4 space-y-2">
          {(payload?.drifts ?? []).length === 0 ? <Empty text="Nenhum drift registrado." /> : (payload?.drifts ?? []).map(drift => <div key={drift.id} className="grid gap-2 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 lg:grid-cols-[1fr_180px_180px_130px] lg:items-center"><div><b className="block truncate text-[10px] text-zinc-200">{drift.funnel_name || drift.funnel_id}</b><span className="mt-1 block font-mono text-[8px] text-[var(--althea-muted)]">{drift.correlation_id}</span></div><span className="text-[9px] text-[var(--althea-muted)]">Esperado: {drift.expected_gateway_name || drift.expected_gateway_id || '—'}</span><span className="text-[9px] text-[var(--althea-muted)]">Observado: {drift.observed_gateway_name || drift.observed_gateway_id || drift.observed_remote_gateway_ref || '—'}</span><div className="flex items-center justify-between gap-2"><Badge status={drift.status} /><span className="text-[8px] text-[var(--althea-muted)]">{dateTime(drift.last_seen_at)}</span></div></div>)}
        </div>
      </section>
    </div>
  )
}

function Metric({ icon: Icon, label, value, success = false, warning = false }: { icon: typeof Network; label: string; value: number; success?: boolean; warning?: boolean }) {
  return <article className="min-h-[108px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><div className="flex items-center justify-between gap-2"><span className="text-[9px] text-[var(--althea-muted)]">{label}</span><Icon size={14} className={warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-[#718079]'} /></div><strong className={`mt-4 block text-[21px] font-semibold ${warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-white'}`}>{value}</strong></article>
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3"><span className="text-[8px] text-[var(--althea-muted)]">{label}</span><b className="mt-1 block truncate text-[10px] text-zinc-200">{value}</b></div>
}

function Badge({ status, target = false }: { status: string; target?: boolean }) {
  const label = target ? targetLabels[status] || status : batchLabels[status] || status
  return <span className={`inline-flex w-fit rounded-full border px-2 py-1 text-[8px] font-semibold ${statusClass(status)}`}>{label}</span>
}

function Skeleton({ rows }: { rows: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}</div>
}

function Empty({ text: value }: { text: string }) {
  return <div className="grid min-h-[120px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] px-4 text-center"><div><CheckCircle2 size={19} className="mx-auto text-[var(--althea-brand)] opacity-60" /><p className="mt-2 text-[9px] text-[var(--althea-muted)]">{value}</p></div></div>
}
