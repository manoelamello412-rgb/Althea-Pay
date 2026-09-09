'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Cpu, Download, GitBranch, RefreshCw, Save, ShieldCheck, TriangleAlert } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type GatewayEnvironment = 'sandbox' | 'production'
type GatewayStatus = 'inactive' | 'active' | 'error'
type RoutingRootType = 'direct' | 'split' | 'conditional'

type JsonRecord = Record<string, unknown>

export interface GatewayFlowStudioProps {
  currentTenantId: string
  currentFunnelId: string
}

interface GatewayMetadata {
  id: string
  display_name: string
  provider: string
  environment: GatewayEnvironment
  status: GatewayStatus
}

interface RoutingPolicy {
  id: string
  user_id: string
  funnel_id: string
  name: string
  is_active: boolean
  routing_graph: JsonRecord
  version: number
  updated_at: string
}

interface RoutingNodeSummary {
  type: RoutingRootType
  condition?: string
  gatewayId?: string
  gateways: Array<{ id: string; weight?: number }>
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asRootType = (value: unknown): RoutingRootType | null => {
  const type = String(value ?? '').toLowerCase()
  return type === 'direct' || type === 'split' || type === 'conditional' ? type : null
}

const extractNodeSummary = (graph: JsonRecord): RoutingNodeSummary => {
  const type = asRootType(graph.type ?? graph.node_type) ?? 'direct'
  const gatewayId = typeof graph.gateway_id === 'string' ? graph.gateway_id : undefined
  const condition = typeof graph.condition === 'string' ? graph.condition : undefined
  const gateways: Array<{ id: string; weight?: number }> = []
  const candidates = Array.isArray(graph.gateways) ? graph.gateways : Array.isArray(graph.children) ? graph.children : []

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const id = typeof candidate.gateway_id === 'string'
      ? candidate.gateway_id
      : typeof candidate.id === 'string'
        ? candidate.id
        : ''
    if (!id) continue
    const weight = typeof candidate.weight === 'number' ? candidate.weight : undefined
    gateways.push({ id, weight })
  }

  return { type, condition, gatewayId, gateways }
}

const prettyJson = (value: JsonRecord): string => JSON.stringify(value, null, 2)

const downloadJson = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function GatewayFlowStudio({ currentTenantId, currentFunnelId }: GatewayFlowStudioProps) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [gateways, setGateways] = useState<GatewayMetadata[]>([])
  const [policies, setPolicies] = useState<RoutingPolicy[]>([])
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [policies, selectedPolicyId],
  )

  const gatewayMap = useMemo(
    () => new Map(gateways.map((gateway) => [gateway.id, gateway])),
    [gateways],
  )

  const load = useCallback(async () => {
    if (!currentTenantId || !currentFunnelId) return
    setLoading(true)
    setError(null)
    try {
      const [gatewayResult, policyResult] = await Promise.all([
        db.from('gateways')
          .select('id,display_name,provider,environment,status')
          .eq('user_id', currentTenantId)
          .order('display_name', { ascending: true }),
        db.from('gateway_routing_policies')
          .select('id,user_id,funnel_id,name,is_active,routing_graph,version,updated_at')
          .eq('user_id', currentTenantId)
          .eq('funnel_id', currentFunnelId)
          .order('updated_at', { ascending: false }),
      ])

      if (gatewayResult.error) throw gatewayResult.error
      if (policyResult.error) throw policyResult.error

      const nextGateways: GatewayMetadata[] = (gatewayResult.data ?? []).map((row) => ({
        id: String(row.id),
        display_name: String(row.display_name),
        provider: String(row.provider),
        environment: String(row.environment).toLowerCase() === 'sandbox' ? 'sandbox' : 'production',
        status: String(row.status).toLowerCase() === 'active'
          ? 'active'
          : String(row.status).toLowerCase() === 'error'
            ? 'error'
            : 'inactive',
      }))

      const nextPolicies: RoutingPolicy[] = (policyResult.data ?? [])
        .filter((row) => isRecord(row.routing_graph))
        .map((row) => ({
          id: String(row.id),
          user_id: String(row.user_id),
          funnel_id: String(row.funnel_id),
          name: String(row.name),
          is_active: Boolean(row.is_active),
          routing_graph: row.routing_graph as JsonRecord,
          version: Number(row.version ?? 1),
          updated_at: String(row.updated_at),
        }))

      setGateways(nextGateways)
      setPolicies(nextPolicies)
      setSelectedPolicyId((current) =>
        nextPolicies.some((policy) => policy.id === current)
          ? current
          : nextPolicies[0]?.id ?? '',
      )
      setNotice(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o controle de roteamento do Gateway.')
    } finally {
      setLoading(false)
    }
  }, [currentFunnelId, currentTenantId, db])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (selectedPolicy) setDraft(prettyJson(selectedPolicy.routing_graph))
    else setDraft('')
  }, [selectedPolicy])

  const saveGraph = async (): Promise<void> => {
    if (!selectedPolicy || saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const parsed: unknown = JSON.parse(draft)
      if (!isRecord(parsed)) throw new Error('O grafo precisa ser um objeto JSON.')
      const rootType = asRootType(parsed.type ?? parsed.node_type)
      if (!rootType) throw new Error('O nó raiz precisa usar type=direct, split ou conditional.')

      const { error: updateError } = await db
        .from('gateway_routing_policies')
        .update({ routing_graph: parsed, version: selectedPolicy.version + 1 })
        .eq('id', selectedPolicy.id)
        .eq('user_id', currentTenantId)
        .eq('funnel_id', currentFunnelId)
        .eq('version', selectedPolicy.version)

      if (updateError) throw updateError
      setNotice('Grafo persistido no Gateway Routing Policy.')
      await load()
    } catch (cause) {
      setError(cause instanceof SyntaxError
        ? 'JSON inválido. Corrija a estrutura antes de salvar.'
        : cause instanceof Error
          ? cause.message
          : 'Não foi possível persistir o grafo.')
    } finally {
      setSaving(false)
    }
  }

  const summary = selectedPolicy ? extractNodeSummary(selectedPolicy.routing_graph) : null

  return (
    <section className="w-full space-y-4 rounded-2xl border border-neutral-800 bg-[#09090b] p-4 text-zinc-100 shadow-2xl shadow-black/20 md:p-5">
      <header className="flex flex-col gap-3 border-b border-neutral-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-900/50 bg-emerald-950/20 text-emerald-400">
            <GitBranch className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">Gateway Flow Studio</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Routing real · tenant isolado · persistência Supabase</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Sincronizar
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/20 p-3 text-xs text-rose-300" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {notice && <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-300">{notice}</div>}

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
              <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-600">Gateways disponíveis</span>
              <strong className="mt-1 block text-lg">{gateways.length}</strong>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
              <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-600">Políticas do funil</span>
              <strong className="mt-1 block text-lg">{policies.length}</strong>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-3">
              <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-600">Estado</span>
              <strong className="mt-1 flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Dados reais</strong>
            </div>
          </div>

          {policies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/20 px-5 py-12 text-center">
              <Cpu className="mx-auto h-6 w-6 text-neutral-600" />
              <h3 className="mt-3 text-sm font-medium text-neutral-300">Nenhuma política de roteamento cadastrada</h3>
              <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-neutral-500">O Studio não cria uma política fictícia. Cadastre uma política no backend de Gateway Routing para que ela apareça aqui.</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="space-y-2">
                <div className="px-1 text-[9px] font-mono uppercase tracking-wider text-neutral-600">Políticas</div>
                {policies.map((policy) => (
                  <button key={policy.id} type="button" onClick={() => setSelectedPolicyId(policy.id)} className={`w-full rounded-xl border p-3 text-left transition ${policy.id === selectedPolicyId ? 'border-emerald-900/70 bg-emerald-950/15' : 'border-neutral-800 bg-neutral-900/20 hover:border-neutral-700'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-neutral-200">{policy.name}</span>
                      {policy.is_active && <span className="text-[9px] font-mono text-emerald-400">ATIVA</span>}
                    </div>
                    <span className="mt-1 block text-[9px] font-mono text-neutral-600">v{policy.version} · {new Date(policy.updated_at).toLocaleString('pt-BR')}</span>
                  </button>
                ))}
              </aside>

              <div className="min-w-0 space-y-4">
                {summary && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/25 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-400" /><span className="text-xs font-semibold">Árvore de decisão</span></div>
                      <span className="rounded-full border border-neutral-800 px-2 py-1 text-[9px] font-mono uppercase text-neutral-500">ROOT: {summary.type}</span>
                    </div>
                    <div className="space-y-2 font-mono text-[10px]">
                      {summary.condition && <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-amber-300">CONDITION · {summary.condition}</div>}
                      {summary.gatewayId && <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-emerald-300">DIRECT · {gatewayMap.get(summary.gatewayId)?.display_name ?? summary.gatewayId}</div>}
                      {summary.gateways.map((target) => (
                        <div key={`${target.id}-${target.weight ?? 'direct'}`} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2.5">
                          <span className="truncate text-neutral-300">{gatewayMap.get(target.id)?.display_name ?? target.id}</span>
                          <span className="shrink-0 text-neutral-500">{target.weight == null ? 'TARGET' : `${target.weight}%`}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-xs font-semibold text-neutral-200">Routing Graph JSONB</h3>
                      <p className="text-[10px] text-neutral-600">Alteração condicionada à política, tenant e versão atuais.</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => selectedPolicy && downloadJson(`gateway-routing-${selectedPolicy.id}.json`, prettyJson(selectedPolicy.routing_graph))} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 text-[10px] text-neutral-400 hover:text-white"><Download className="h-3.5 w-3.5" /> Exportar</button>
                      <button type="button" onClick={() => void saveGraph()} disabled={saving || !selectedPolicy} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[10px] font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"><Save className="h-3.5 w-3.5" /> {saving ? 'Salvando…' : 'Salvar'}</button>
                    </div>
                  </div>
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="JSONB da política de roteamento" className="min-h-[320px] w-full resize-y rounded-lg border border-neutral-800 bg-[#070709] p-3 font-mono text-[11px] leading-5 text-neutral-300 outline-none focus:border-emerald-900" />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default GatewayFlowStudio
