'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Network, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type GlobalGatewayChoice = {
  id: string
  name: string
  provider: string
  rawStatus: string
}

type Batch = {
  id: string
  correlation_id: string
  command_type: 'gateway_switch' | 'gateway_rollback'
  target_gateway_id: string | null
  dry_run: boolean
  allow_partial: boolean
  status: string
  total_targets: number
  succeeded_targets: number
  failed_targets: number
  pending_targets: number
  metadata: Record<string, unknown>
  requested_at: string
  completed_at: string | null
}

type Target = {
  id: string
  funnel_id: string
  target_gateway_id: string
  previous_gateway_id: string | null
  status: string
  attempt_count: number
  max_attempts: number
  last_error_code: string | null
  last_error_message: string | null
  correlation_id: string
}

const terminalBatchStatuses = new Set(['preflight_failed', 'succeeded', 'partial', 'failed', 'cancelled'])
const batchLabels: Record<string, string> = {
  queued: 'Na fila',
  running: 'Processando',
  preflight_failed: 'Pré-validação bloqueada',
  succeeded: 'Concluído',
  partial: 'Concluído parcialmente',
  failed: 'Falhou',
  cancelled: 'Cancelado',
}
const targetLabels: Record<string, string> = {
  queued: 'Na fila',
  running: 'Processando',
  retry: 'Tentando novamente',
  blocked: 'Bloqueado',
  preflight_succeeded: 'Pré-validado',
  verified: 'Verificado',
  failed: 'Falhou',
  cancelled: 'Cancelado',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function statusTone(status: string) {
  if (['succeeded', 'verified', 'preflight_succeeded'].includes(status)) return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
  if (['partial', 'retry', 'queued', 'running'].includes(status)) return 'border-amber-400/20 bg-amber-400/10 text-amber-200'
  if (['failed', 'blocked', 'preflight_failed', 'cancelled'].includes(status)) return 'border-rose-400/20 bg-rose-400/10 text-rose-200'
  return 'border-white/10 bg-white/[0.04] text-zinc-400'
}

export function GlobalFunnelGatewaySwitch({ gateways }: { gateways: GlobalGatewayChoice[] }) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const eligibleGateways = useMemo(
    () => gateways.filter((gateway) => ['connected', 'degraded'].includes(gateway.rawStatus.toLowerCase())),
    [gateways],
  )
  const [gatewayId, setGatewayId] = useState('')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [funnelNames, setFunnelNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'preflight' | 'execute' | 'rollback' | 'refresh' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (gatewayId && !eligibleGateways.some((gateway) => gateway.id === gatewayId)) setGatewayId('')
  }, [eligibleGateways, gatewayId])

  const loadBatch = useCallback(async (batchId?: string | null) => {
    let query = db
      .from('funnel_command_batches')
      .select('id,correlation_id,command_type,target_gateway_id,dry_run,allow_partial,status,total_targets,succeeded_targets,failed_targets,pending_targets,metadata,requested_at,completed_at')

    query = batchId
      ? query.eq('id', batchId)
      : query.in('command_type', ['gateway_switch', 'gateway_rollback']).order('requested_at', { ascending: false }).limit(1)

    const { data: batchData, error: batchError } = await query.maybeSingle()
    if (batchError) throw batchError
    if (!batchData) {
      setBatch(null)
      setTargets([])
      setFunnelNames({})
      return null
    }

    const nextBatch = batchData as Batch
    const { data: targetData, error: targetError } = await db
      .from('funnel_command_targets')
      .select('id,funnel_id,target_gateway_id,previous_gateway_id,status,attempt_count,max_attempts,last_error_code,last_error_message,correlation_id')
      .eq('batch_id', nextBatch.id)
      .order('created_at', { ascending: true })
    if (targetError) throw targetError

    const nextTargets = (targetData ?? []) as Target[]
    const ids = [...new Set(nextTargets.map((target) => target.funnel_id).filter(Boolean))]
    if (ids.length) {
      const { data: funnelRows } = await db.from('funnels').select('id,nome').in('id', ids)
      setFunnelNames(Object.fromEntries((funnelRows ?? []).map((row) => [String(row.id), String(row.nome || row.id)])))
    } else {
      setFunnelNames({})
    }

    setBatch(nextBatch)
    setTargets(nextTargets)
    return nextBatch
  }, [db])

  useEffect(() => {
    void loadBatch().catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico de troca global.'))
  }, [loadBatch])

  useEffect(() => {
    if (!batch || terminalBatchStatuses.has(batch.status)) return
    const timer = window.setInterval(() => {
      void loadBatch(batch.id).catch(() => undefined)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [batch, loadBatch])

  const kickWorker = useCallback(async (batchId: string) => {
    const { data: sessionData, error: sessionError } = await db.auth.getSession()
    if (sessionError || !sessionData.session?.access_token) throw new Error('Sessão expirada. Faça login novamente.')
    const { error: workerError } = await db.functions.invoke('funnel-command-worker', {
      body: { batch_id: batchId, limit: 50 },
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    })
    if (workerError) {
      setNotice('Comando enfileirado. O worker automático continuará o processamento.')
      return false
    }
    return true
  }, [db])

  const requestSwitch = useCallback(async (dryRun: boolean) => {
    if (!gatewayId) return
    setBusy(dryRun ? 'preflight' : 'execute')
    setError('')
    setNotice('')
    try {
      if (!dryRun) {
        if (!batch || !batch.dry_run || batch.status !== 'succeeded' || batch.target_gateway_id !== gatewayId) {
          throw new Error('Execute e conclua a pré-validação para esta gateway antes da troca global.')
        }
      }

      const { data, error: rpcError } = await db.rpc('request_global_funnel_gateway_switch', {
        p_gateway_id: gatewayId,
        p_dry_run: dryRun,
        p_allow_partial: false,
        p_idempotency_key: `frontend:${dryRun ? 'preflight' : 'execute'}:${gatewayId}:${crypto.randomUUID()}`,
      })
      if (rpcError) throw rpcError
      const result = record(data)
      const batchId = typeof result.batch_id === 'string' ? result.batch_id : ''
      if (!batchId) throw new Error('O backend não retornou o identificador do batch.')

      setNotice(dryRun
        ? 'Pré-validação criada. Nenhum gateway será alterado nesta etapa.'
        : 'Troca global autorizada. O worker está sincronizando os funis elegíveis e verificando o estado remoto.')

      await loadBatch(batchId)
      await kickWorker(batchId)
      await loadBatch(batchId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a operação global.')
    } finally {
      setBusy(null)
    }
  }, [batch, db, gatewayId, kickWorker, loadBatch])

  const rollback = useCallback(async () => {
    if (!batch || batch.dry_run || batch.command_type !== 'gateway_switch' || !['succeeded', 'partial'].includes(batch.status)) return
    setBusy('rollback')
    setError('')
    setNotice('')
    try {
      const { data, error: rpcError } = await db.rpc('request_funnel_gateway_rollback', {
        p_batch_id: batch.id,
        p_allow_partial: false,
        p_idempotency_key: `frontend:rollback:${batch.id}:${crypto.randomUUID()}`,
      })
      if (rpcError) throw rpcError
      const result = record(data)
      const rollbackBatchId = typeof result.batch_id === 'string' ? result.batch_id : ''
      if (!rollbackBatchId) throw new Error('O backend não retornou o batch de rollback.')
      setNotice('Rollback enfileirado. O estado anterior será restaurado apenas nos funis com referência remota verificável.')
      await loadBatch(rollbackBatchId)
      await kickWorker(rollbackBatchId)
      await loadBatch(rollbackBatchId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar o rollback.')
    } finally {
      setBusy(null)
    }
  }, [batch, db, kickWorker, loadBatch])

  const refresh = useCallback(async () => {
    setBusy('refresh')
    setError('')
    try { await loadBatch(batch?.id ?? null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o batch.') }
    finally { setBusy(null) }
  }, [batch?.id, loadBatch])

  const selectedGateway = eligibleGateways.find((gateway) => gateway.id === gatewayId) ?? null
  const preflightReady = Boolean(batch?.dry_run && batch.status === 'succeeded' && batch.target_gateway_id === gatewayId)
  const canRollback = Boolean(batch && !batch.dry_run && batch.command_type === 'gateway_switch' && ['succeeded', 'partial'].includes(batch.status))
  const phase = typeof batch?.metadata?.phase === 'string' ? batch.metadata.phase : batch?.dry_run ? 'preflight' : '—'

  return (
    <section className="space-y-4 rounded-2xl border border-emerald-500/15 bg-[#0a0a0c] p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><Network className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-bold text-white">Orquestração global de gateway</h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-5 text-zinc-500">Pré-valida todos os funis, altera a gateway no provedor remoto, verifica a mudança e só então atualiza o binding local. Falhas bloqueiam a execução; não existe sucesso simulado.</p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy !== null} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] px-3 text-[10px] font-bold text-zinc-400 transition hover:text-white disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

      {eligibleGateways.length === 0 ? (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-3 text-[10px] leading-5 text-amber-200/70">
          Nenhuma gateway está em estado <strong>connected</strong> ou <strong>degraded</strong>. O backend exige uma gateway validada nesses estados para a troca global remota.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">Gateway de destino</span>
            <select
              value={gatewayId}
              onChange={(event) => { setGatewayId(event.target.value); setError(''); setNotice('') }}
              disabled={busy !== null}
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#111315] px-3 text-xs text-white outline-none disabled:opacity-50"
            >
              <option value="">Selecione uma gateway validada</option>
              {eligibleGateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.name} · {gateway.provider} · {gateway.rawStatus}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void requestSwitch(true)} disabled={!gatewayId || busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 text-[10px] font-bold text-emerald-300 disabled:opacity-40">
              {busy === 'preflight' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Pré-validar
            </button>
            <button type="button" onClick={() => void requestSwitch(false)} disabled={!preflightReady || busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-[10px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-35">
              {busy === 'execute' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />} Executar globalmente
            </button>
          </div>
        </div>
      )}

      {selectedGateway && !preflightReady && (
        <p className="text-[10px] leading-5 text-zinc-600">A execução real fica bloqueada até a pré-validação desta gateway terminar com 100% dos alvos elegíveis aprovados.</p>
      )}

      {notice && <div role="status" className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.05] px-3 py-2.5 text-[10px] leading-5 text-emerald-200">{notice}</div>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2.5 text-[10px] leading-5 text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      {batch && (
        <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#0e1010] p-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold ${statusTone(batch.status)}`}>{batchLabels[batch.status] || batch.status}</span>
                <span className="text-[9px] font-mono text-zinc-600">{batch.correlation_id}</span>
                <span className="text-[9px] uppercase text-zinc-600">{batch.command_type === 'gateway_rollback' ? 'ROLLBACK' : batch.dry_run ? 'DRY RUN' : 'EXECUÇÃO'} · {phase}</span>
              </div>
              <p className="mt-2 text-[10px] text-zinc-500">Destino: {batch.target_gateway_id || 'gateway anterior por funil'}</p>
            </div>
            {canRollback && <button type="button" onClick={() => void rollback()} disabled={busy !== null} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 text-[10px] font-bold text-amber-200 disabled:opacity-40">{busy === 'rollback' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Rollback verificado</button>}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Alvos', batch.total_targets], ['Concluídos', batch.succeeded_targets], ['Falhas', batch.failed_targets], ['Pendentes', batch.pending_targets]].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-white/[0.05] bg-black/20 p-3"><span className="text-[8px] uppercase tracking-wider text-zinc-600">{label}</span><strong className="mt-1 block text-lg text-white">{value}</strong></div>
            ))}
          </div>

          {targets.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full min-w-[760px] text-left">
                <thead><tr className="border-b border-white/[0.06] text-[8px] uppercase tracking-wider text-zinc-600"><th className="px-3 py-2.5">Funil</th><th className="px-3 py-2.5">Estado</th><th className="px-3 py-2.5">Tentativas</th><th className="px-3 py-2.5">Gateway anterior</th><th className="px-3 py-2.5">Diagnóstico</th></tr></thead>
                <tbody>{targets.map((target) => <tr key={target.id} className="border-b border-white/[0.04] last:border-0"><td className="px-3 py-3 text-[10px] font-semibold text-zinc-200">{funnelNames[target.funnel_id] || target.funnel_id}</td><td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[9px] ${statusTone(target.status)}`}>{targetLabels[target.status] || target.status}</span></td><td className="px-3 py-3 text-[10px] text-zinc-500">{target.attempt_count}/{target.max_attempts}</td><td className="px-3 py-3 font-mono text-[9px] text-zinc-500">{target.previous_gateway_id || '—'}</td><td className="max-w-[320px] px-3 py-3 text-[9px] leading-4 text-zinc-500">{target.last_error_message || target.last_error_code || (target.status === 'verified' || target.status === 'preflight_succeeded' ? <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Verificado pelo provedor remoto</span> : '—')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
