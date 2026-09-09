'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  Network,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type GatewayRow = {
  id: string
  name: string
  provider: string
  status: 'pending' | 'connected' | 'disconnected' | 'error'
  updated_at: string
}

type SaleRow = {
  amount: number | string | null
  status: 'pending' | 'approved' | 'failed' | 'cancelled' | 'refunded' | 'chargeback'
  created_at: string
}

type EventRow = {
  id: string
  provider: string | null
  event_type: string
  signature_valid: boolean | null
  created_at: string
  processed_at: string | null
}

type AuditRow = {
  id: string
  action: string
  resource_type: string | null
  details: Record<string, unknown> | null
  created_at: string
}

type ActivityItem = {
  id: string
  time: string
  title: string
  description: string
  tone: 'success' | 'warning' | 'neutral'
}

type IaraResponse = {
  id: string
  sender: string
  content: string
  created_at: string
  error?: string
}

type MetricState = {
  health: number
  approval: number
  latencyMs: number | null
  incidents: number
  onlineGateways: number
  totalGateways: number
}

const EMPTY_METRICS: MetricState = {
  health: 0,
  approval: 0,
  latencyMs: null,
  incidents: 0,
  onlineGateways: 0,
  totalGateways: 0,
}

const formatPercent = (value: number) => `${value.toFixed(1).replace('.', ',')}%`

const formatTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

const formatLatency = (value: number | null) => (value === null ? '—' : `${Math.round(value)} ms`)

const statusLabel: Record<GatewayRow['status'], string> = {
  connected: 'ONLINE',
  pending: 'PENDENTE',
  disconnected: 'DESCONECTADO',
  error: 'ISOLADO',
}

const providerTone = (provider: string) => {
  const normalized = provider.toLowerCase()
  if (normalized.includes('adyen')) return 'bg-emerald-950/70 text-emerald-400'
  if (normalized.includes('stripe')) return 'bg-indigo-950/70 text-indigo-300'
  if (normalized.includes('mercado')) return 'bg-sky-950/70 text-sky-300'
  if (normalized.includes('pagar')) return 'bg-zinc-900 text-zinc-300'
  return 'bg-[#121614] text-zinc-300'
}

export default function IaraCopilot() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()

  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [gateways, setGateways] = useState<GatewayRow[]>([])
  const [metrics, setMetrics] = useState<MetricState>(EMPTY_METRICS)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const loadOperationalData = useCallback(async (orgId: string, silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const [gatewayResult, salesResult, eventsResult, auditResult] = await Promise.all([
        db
          .from('gateway_connections')
          .select('id,name,provider,status,updated_at')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: true }),
        db
          .from('sales')
          .select('amount,status,created_at')
          .eq('organization_id', orgId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1000),
        db
          .from('integration_events')
          .select('id,provider,event_type,signature_valid,created_at,processed_at')
          .eq('organization_id', orgId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(30),
        db
          .from('audit_logs')
          .select('id,action,resource_type,details,created_at')
          .eq('organization_id', orgId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(30),
      ])

      if (gatewayResult.error) throw new Error('Não foi possível carregar os gateways.')
      if (salesResult.error) throw new Error('Não foi possível carregar as métricas de vendas.')
      if (eventsResult.error) throw new Error('Não foi possível carregar a telemetria.')
      if (auditResult.error) throw new Error('Não foi possível carregar a trilha de atividades.')

      const gatewayRows = (gatewayResult.data ?? []) as GatewayRow[]
      const salesRows = (salesResult.data ?? []) as SaleRow[]
      const eventRows = (eventsResult.data ?? []) as EventRow[]
      const auditRows = (auditResult.data ?? []) as AuditRow[]

      const online = gatewayRows.filter((gateway) => gateway.status === 'connected').length
      const total = gatewayRows.length
      const health = total === 0 ? 0 : (online / total) * 100

      const approved = salesRows.filter((sale) => sale.status === 'approved').length
      const rejected = salesRows.filter((sale) => ['failed', 'cancelled', 'chargeback'].includes(sale.status)).length
      const denominator = approved + rejected
      const approval = denominator === 0 ? 0 : (approved / denominator) * 100

      const processingSamples = eventRows
        .filter((event) => event.processed_at)
        .map((event) => new Date(event.processed_at as string).getTime() - new Date(event.created_at).getTime())
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 60_000)
      const latencyMs = processingSamples.length
        ? processingSamples.reduce((sum, value) => sum + value, 0) / processingSamples.length
        : null

      const incidents = eventRows.filter((event) => {
        const type = event.event_type.toLowerCase()
        return type.includes('fail') || type.includes('error') || type.includes('timeout') || event.signature_valid === false
      }).length + gatewayRows.filter((gateway) => gateway.status === 'error').length

      const eventActivities: ActivityItem[] = eventRows.slice(0, 8).map((event) => {
        const isIncident = event.signature_valid === false || /fail|error|timeout/i.test(event.event_type)
        return {
          id: `event-${event.id}`,
          time: formatTime(event.created_at),
          title: event.provider ? `${event.provider} · ${event.event_type}` : event.event_type,
          description: event.processed_at ? 'Evento recebido e processado pelo pipeline operacional.' : 'Evento recebido; processamento ainda não confirmado.',
          tone: isIncident ? 'warning' : event.processed_at ? 'success' : 'neutral',
        }
      })

      const auditActivities: ActivityItem[] = auditRows.slice(0, 8).map((audit) => ({
        id: `audit-${audit.id}`,
        time: formatTime(audit.created_at),
        title: `${audit.action.toUpperCase()} · ${audit.resource_type ?? 'operação'}`,
        description: 'Alteração registrada na trilha de auditoria da organização.',
        tone: 'neutral',
      }))

      const mergedActivities = [...eventActivities, ...auditActivities]
        .sort((a, b) => b.time.localeCompare(a.time))
        .slice(0, 8)

      setGateways(gatewayRows)
      setMetrics({ health, approval, latencyMs, incidents, onlineGateways: online, totalGateways: total })
      setActivities(mergedActivities)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar a operação.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) {
        router.replace('/login')
        return
      }

      const { data: membership, error: membershipError } = await db
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', auth.user.id)
        .limit(1)
        .maybeSingle()

      if (membershipError || !membership?.organization_id) {
        if (!cancelled) {
          setError('Sua conta ainda não possui uma organização operacional vinculada.')
          setLoading(false)
        }
        return
      }

      if (cancelled) return
      setOrganizationId(membership.organization_id)
      await loadOperationalData(membership.organization_id)
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [db, loadOperationalData, router])

  useEffect(() => {
    if (!organizationId) return

    const channel = db
      .channel(`iara-operations-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `organization_id=eq.${organizationId}` }, () => {
        void loadOperationalData(organizationId, true)
      })
      .subscribe()

    const interval = window.setInterval(() => {
      void loadOperationalData(organizationId, true)
    }, 30_000)

    return () => {
      window.clearInterval(interval)
      void db.removeChannel(channel)
    }
  }, [db, loadOperationalData, organizationId])

  const createIaraSession = useCallback(async () => {
    if (sessionId) return sessionId
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return null

    const { data, error: createError } = await db
      .from('chat_sessions')
      .insert({ user_id: auth.user.id, title: 'IARA · Operação' })
      .select('id')
      .single()

    if (createError || !data?.id) return null
    setSessionId(data.id)
    return data.id as string
  }, [db, sessionId])

  const askIara = useCallback(async (value?: string) => {
    const text = (value ?? command).trim()
    if (!text || sending) return

    setCommand('')
    setSending(true)
    setAnswer(null)
    setError(null)

    try {
      const activeSessionId = await createIaraSession()
      if (!activeSessionId) throw new Error('Não foi possível iniciar a sessão da IARA.')

      const clientRequestId = crypto.randomUUID()
      const { data, error: invokeError } = await db.functions.invoke<IaraResponse>('iara-ai-core', {
        body: { sessionId: activeSessionId, message: text, clientRequestId },
      })

      if (invokeError) throw new Error(invokeError.message || 'A IARA não conseguiu processar o comando.')
      if (data?.error) throw new Error(data.error)
      if (!data?.content || data.sender !== 'iara') throw new Error('A IARA retornou uma resposta inválida.')
      setAnswer(data.content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao consultar a IARA.')
    } finally {
      setSending(false)
    }
  }, [command, createIaraSession, db, sending])

  const commands = useMemo(() => [
    { icon: Network, title: 'Analisar Gateways', description: 'Verificar performance e saúde', prompt: 'Analise os gateways atuais, identifique riscos e recomende a melhor rota.' },
    { icon: ArrowRight, title: 'Otimizar Roteamento', description: 'Encontrar a melhor rota', prompt: 'Analise o roteamento atual e indique como otimizar a distribuição entre os gateways conectados.' },
    { icon: AlertTriangle, title: 'Detectar Anomalias', description: 'Identificar riscos e falhas', prompt: 'Procure anomalias recentes na operação e explique quais eventos merecem atenção.' },
    { icon: FileText, title: 'Gerar Relatório', description: 'Resumo completo da operação', prompt: 'Gere um resumo operacional das últimas 24 horas com os principais indicadores e riscos.' },
  ], [])

  if (loading) {
    return (
      <section className="min-h-[calc(100dvh-5rem)] bg-[#060706] px-4 py-6 pb-32 text-white">
        <div className="mx-auto max-w-xl space-y-4 animate-pulse">
          <div className="h-24 rounded-2xl border border-white/[0.05] bg-[#0b0d0c]" />
          <div className="h-52 rounded-2xl border border-white/[0.05] bg-[#0b0d0c]" />
          <div className="grid grid-cols-2 gap-3"><div className="h-28 rounded-xl bg-[#0b0d0c]"/><div className="h-28 rounded-xl bg-[#0b0d0c]"/></div>
        </div>
      </section>
    )
  }

  return (
    <section className="min-h-[calc(100dvh-5rem)] bg-[#060706] px-4 py-6 pb-36 text-white sm:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#0d110f] to-[#080a09] p-4 shadow-xl">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[#1DB854]/30 bg-[#1DB854]/10 shadow-[0_0_25px_rgba(29,184,84,.08)]">
              <Sparkles className="h-7 w-7 text-[#1DB854]" />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#1DB854] shadow-[0_0_9px_#1DB854]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="text-base font-bold tracking-tight">IARA</h1><span className="rounded border border-[#1DB854]/20 bg-[#1DB854]/10 px-1.5 py-0.5 text-[8px] font-bold text-[#1DB854]">COPILOT</span></div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">Inteligência operacional da Althea Pay</p>
            </div>
          </div>
          <button type="button" onClick={() => organizationId && void loadOperationalData(organizationId, true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-[#0b0d0c] text-zinc-500 transition hover:text-white" aria-label="Atualizar dados">
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin text-[#1DB854]' : 'h-4 w-4'} />
          </button>
        </div>

        {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-950/10 p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"/><div><p className="text-xs font-semibold text-rose-300">Sincronização indisponível</p><p className="mt-1 text-[11px] leading-relaxed text-rose-200/70">{error}</p></div></div></div>}

        <div className="rounded-2xl border border-white/[0.05] bg-[#0b0d0c] p-4">
          <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
            <div><h2 className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-200">Como está sua operação?</h2><p className="mt-1 text-[9px] text-zinc-600">Indicadores calculados a partir dos dados reais da organização.</p></div>
            <span className="hidden text-[9px] font-mono text-[#1DB854] sm:block">● REALTIME</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Metric label="Saúde da Operação" value={metrics.totalGateways ? formatPercent(metrics.health) : '—'} detail={`${metrics.onlineGateways}/${metrics.totalGateways} online`} positive={metrics.health >= 90} />
            <Metric label="Gateways Online" value={String(metrics.onlineGateways)} detail={`${metrics.totalGateways} configurados`} positive={metrics.onlineGateways > 0} />
            <Metric label="Incidentes" value={String(metrics.incidents)} detail="Últimas 24h" positive={metrics.incidents === 0} />
            <Metric label="Latência de Processamento" value={formatLatency(metrics.latencyMs)} detail="Eventos processados" positive={metrics.latencyMs === null || metrics.latencyMs < 500} />
          </div>

          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-white/[0.03] bg-[#101311] p-3">
            <div><span className="block text-[9px] font-mono uppercase tracking-wider text-zinc-600">Aprovação Geral</span><strong className="mt-0.5 block text-xl font-mono text-zinc-100">{metrics.approval ? formatPercent(metrics.approval) : '—'}</strong></div>
            <div className="text-right"><TrendingUp className="ml-auto h-4 w-4 text-[#1DB854]"/><span className="mt-1 block text-[9px] text-zinc-600">24 horas</span></div>
          </div>
        </div>

        <div className="space-y-3">
          <div><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1DB854]">Ações Inteligentes</h2><p className="mt-1 text-[10px] text-zinc-600">Comandos executados pela IARA com o contexto operacional atual.</p></div>
          <div className="grid grid-cols-2 gap-3">
            {commands.map(({ icon: Icon, title, description, prompt }) => <button key={title} type="button" onClick={() => void askIara(prompt)} disabled={sending} className="group rounded-xl border border-white/[0.05] bg-[#0b0d0c] p-3.5 text-left transition hover:border-[#1DB854]/25 hover:bg-[#0e1210] disabled:cursor-wait disabled:opacity-60"><span className="grid h-8 w-8 place-items-center rounded-lg border border-[#1DB854]/15 bg-[#1DB854]/[0.06] text-[#1DB854]"><Icon className="h-4 w-4"/></span><strong className="mt-3 block text-[11px] text-zinc-200">{title}</strong><span className="mt-1 block text-[9px] leading-relaxed text-zinc-600">{description}</span></button>)}
          </div>
        </div>

        {answer && <div className="rounded-2xl border border-[#1DB854]/20 bg-[#0a110d] p-4"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-[#1DB854]"/><span className="text-[10px] font-bold uppercase tracking-wider text-[#1DB854]">Resposta da IARA</span></div><p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{answer}</p></div>}

        <div className="space-y-3">
          <div><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300">Atividade da IARA</h2><p className="mt-1 text-[10px] text-zinc-600">Eventos e alterações observados na operação.</p></div>
          <div className="overflow-hidden rounded-xl border border-white/[0.05] bg-[#0b0d0c]">
            {activities.length === 0 ? <Empty icon={Activity} title="Nenhuma atividade recente" description="A trilha operacional aparecerá aqui quando houver eventos."/> : activities.map((activity) => <div key={activity.id} className="flex gap-3 border-b border-white/[0.04] p-3 last:border-b-0"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${activity.tone === 'warning' ? 'bg-amber-400' : activity.tone === 'success' ? 'bg-[#1DB854] shadow-[0_0_7px_#1DB854]' : 'bg-zinc-600'}`} /><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><strong className="truncate text-[10px] text-zinc-300">{activity.title}</strong><time className="shrink-0 text-[9px] font-mono text-zinc-700">{activity.time}</time></div><p className="mt-0.5 text-[9px] leading-relaxed text-zinc-600">{activity.description}</p></div></div>)}
          </div>
        </div>

        <div className="space-y-3">
          <div><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300">Status dos Gateways</h2><p className="mt-1 text-[10px] text-zinc-600">Disponibilidade real das conexões configuradas.</p></div>
          <div className="overflow-hidden rounded-xl border border-white/[0.05] bg-[#0b0d0c]">
            {gateways.length === 0 ? <Empty icon={Network} title="Nenhum gateway configurado" description="Conecte uma adquirente para a IARA começar o monitoramento."/> : gateways.map((gateway) => { const online = gateway.status === 'connected'; return <div key={gateway.id} className="flex items-center gap-3 border-b border-white/[0.04] p-3.5 last:border-b-0"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[9px] font-bold ${providerTone(gateway.provider)}`}>{gateway.provider.slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><strong className="block truncate text-[11px] text-zinc-200">{gateway.name}</strong><span className="mt-0.5 block truncate text-[9px] text-zinc-600">{gateway.provider}</span></div><div className="text-right"><span className={`flex items-center justify-end gap-1.5 text-[9px] font-mono font-bold ${online ? 'text-[#1DB854]' : gateway.status === 'error' ? 'text-rose-400' : 'text-zinc-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-[#1DB854] shadow-[0_0_7px_#1DB854]' : gateway.status === 'error' ? 'bg-rose-500' : 'bg-zinc-600'}`}/>{statusLabel[gateway.status]}</span><span className="mt-0.5 block text-[8px] text-zinc-700">Atualizado {formatTime(gateway.updated_at)}</span></div></div> })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.05] bg-[#0b0d0c] p-4">
          <div className="flex items-center justify-between"><div><h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-300">Taxa de aprovação · 24h</h2><p className="mt-1 text-[9px] text-zinc-600">Cálculo sobre transações aprovadas e recusadas.</p></div><span className="text-xl font-bold font-mono text-[#1DB854]">{metrics.approval ? formatPercent(metrics.approval) : '—'}</span></div>
          <div className="mt-4 h-16 overflow-hidden rounded-lg border border-white/[0.03] bg-[#080a09] p-1"><svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-full w-full"><path d="M0 18 C12 17 18 16 28 17 S45 12 54 14 S67 8 78 10 S91 4 100 5 L100 24 L0 24 Z" fill="rgba(29,184,84,.08)"/><path d="M0 18 C12 17 18 16 28 17 S45 12 54 14 S67 8 78 10 S91 4 100 5" fill="none" stroke="#1DB854" strokeWidth=".8" strokeLinecap="round"/></svg></div>
          <div className="mt-2 flex justify-between text-[8px] font-mono text-zinc-700"><span>24h</span><span>18h</span><span>12h</span><span>6h</span><span>agora</span></div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void askIara() }} className="sticky bottom-24 z-20 flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-[#0a0d0b]/95 p-2 backdrop-blur-xl shadow-2xl">
          <Bot className="ml-2 h-4 w-4 shrink-0 text-[#1DB854]"/><input value={command} onChange={(event) => setCommand(event.target.value)} disabled={sending} placeholder="Pergunte algo para a IARA..." className="min-w-0 flex-1 bg-transparent px-1 py-3 text-xs text-white outline-none placeholder:text-zinc-700"/><button type="submit" disabled={!command.trim() || sending} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#1DB854] text-black transition disabled:cursor-not-allowed disabled:opacity-30" aria-label="Enviar para a IARA"><Send className="h-4 w-4"/></button>
        </form>
      </div>
    </section>
  )
}

function Metric({ label, value, detail, positive }: { label: string; value: string; detail: string; positive: boolean }) {
  return <div className="rounded-xl border border-white/[0.03] bg-[#101311] p-3"><span className="block text-[8px] font-mono uppercase tracking-wider text-zinc-600">{label}</span><div className="mt-1 flex items-end justify-between gap-2"><strong className="text-lg font-bold font-mono text-zinc-100">{value}</strong><span className={`text-[8px] font-mono font-bold ${positive ? 'text-[#1DB854]' : 'text-amber-400'}`}>{positive ? '● Estável' : '● Atenção'}</span></div><span className="mt-1 block truncate text-[8px] text-zinc-700">{detail}</span></div>
}

function Empty({ icon: Icon, title, description }: { icon: typeof Activity; title: string; description: string }) {
  return <div className="flex flex-col items-center justify-center px-5 py-10 text-center"><Icon className="h-6 w-6 text-zinc-700"/><strong className="mt-3 text-xs text-zinc-400">{title}</strong><p className="mt-1 max-w-xs text-[9px] leading-relaxed text-zinc-700">{description}</p></div>
}
