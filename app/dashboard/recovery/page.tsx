'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  UserRound,
  WalletCards,
  XCircle,
  Zap,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Metrics = {
  abandoned: number
  abandoned_value: number
  queued: number
  sent: number
  recovered: number
  recovered_value: number
  blocked: number
  failed: number
}
type ChannelAccount = {
  id: string
  channel: string
  provider: string
  display_name: string | null
  status: string
}
type Opportunity = {
  event_id: string
  received_at: string
  status: string
  transaction_id: string | null
  buyer_name: string | null
  buyer_email: string | null
  funnel_id: string | null
  product_id: string | null
  amount: number | null
  currency: string | null
  priority: number
  opportunity_type: string
  next_action: string
}
type RecoveryRow = {
  checkout_id: string
  funnel_id: string | null
  funnel_name: string | null
  product_id: string | null
  product_name: string | null
  status: string
  amount: number
  currency: string
  customer: Json
  recovery_status: string | null
  recovery_count: number
  recovery_last_sent_at: string | null
  recovery_next_at: string | null
  abandoned_at: string | null
  created_at: string
  event_status: string | null
  event_attempt_count: number | null
  channel: string | null
  conversation_id: string | null
  outbox_id: string | null
  last_error: string | null
  outbox_status: string | null
  outbox_updated_at: string | null
}
type Payload = {
  metrics: Metrics
  automation: Json
  channel_accounts: ChannelAccount[]
  crm_opportunities: Opportunity[]
  checkouts: RecoveryRow[]
}

const EMPTY_METRICS: Metrics = {
  abandoned: 0,
  abandoned_value: 0,
  queued: 0,
  sent: 0,
  recovered: 0,
  recovered_value: 0,
  blocked: 0,
  failed: 0,
}

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value)

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const money = (value: unknown, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(num(value))

const dateTime = (value: unknown) => {
  const parsed = new Date(text(value))
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const customerName = (customer: Json) =>
  text(customer.name ?? customer.full_name ?? customer.nome ?? customer.email ?? customer.phone) || 'Cliente não identificado'

const statusLabels: Record<string, string> = {
  queued: 'Na fila',
  processing: 'Processando',
  queued_delivery: 'Aguardando envio',
  processing_delivery: 'Enviando',
  outbox_queued: 'Outbox',
  sent: 'Enviado',
  recovered: 'Recuperado',
  blocked_consent: 'Sem consentimento',
  blocked_no_channel: 'Sem canal ativo',
  blocked_no_destination: 'Sem destino',
  delivery_failed: 'Falha de entrega',
  dead_letter: 'DLQ',
  pending: 'Pendente',
  abandoned: 'Abandonado',
}

function badgeClass(status: string | null) {
  const value = status || ''
  if (value === 'recovered') return 'border-[rgba(29,184,84,.2)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]'
  if (value === 'sent') return 'border-sky-400/15 bg-sky-400/[.06] text-sky-300'
  if (value.startsWith('blocked')) return 'border-[rgba(212,175,55,.2)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]'
  if (['delivery_failed', 'dead_letter'].includes(value)) return 'border-red-400/15 bg-red-400/[.06] text-red-300'
  if (['queued', 'processing', 'queued_delivery', 'processing_delivery', 'outbox_queued'].includes(value)) {
    return 'border-white/[.07] bg-white/[.03] text-zinc-300'
  }
  return 'border-white/[.055] bg-white/[.02] text-[var(--althea-muted)]'
}

export default function RecoveryPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payload, setPayload] = useState<Payload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30 | 90>(7)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await db.rpc('recovery_operations_v1', { p_days: period })
      if (result.error) throw result.error
      const data = obj(result.data)
      setPayload({
        metrics: { ...EMPTY_METRICS, ...obj(data.metrics) } as Metrics,
        automation: obj(data.automation),
        channel_accounts: Array.isArray(data.channel_accounts) ? data.channel_accounts as ChannelAccount[] : [],
        crm_opportunities: Array.isArray(data.crm_opportunities) ? data.crm_opportunities as Opportunity[] : [],
        checkouts: Array.isArray(data.checkouts) ? data.checkouts as RecoveryRow[] : [],
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a operação de Recovery.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db, period])

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
      }, 500)
    }
    const channel = db.channel(`recovery-operations-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recovery_events', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId])

  const requeue = async (checkoutId: string) => {
    if (working) return
    setWorking(checkoutId)
    setError('')
    const result = await db.rpc('recovery_operator_requeue_checkout_v1', { p_checkout_id: checkoutId })
    if (result.error) setError(result.error.message)
    else await load(false)
    setWorking('')
  }

  const executeOpportunity = async (eventId: string) => {
    if (working) return
    setWorking(eventId)
    setError('')
    try {
      const response = await fetch('/api/crm/recovery/opportunities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_id: eventId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Não foi possível acionar a recuperação CRM.')
      await load(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao acionar recuperação CRM.')
    } finally {
      setWorking('')
    }
  }

  const metrics = payload?.metrics ?? EMPTY_METRICS
  const accounts = payload?.channel_accounts ?? []
  const automationEnabled = payload?.automation.cartAutomation === true
  const runtimeReady = automationEnabled && accounts.length > 0

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Revenue Recovery</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Central de Recovery</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Checkout abandonado → elegibilidade → consentimento → canal conectado → outbox → entrega real → receita recuperada. Cada estado é exibido sem simular sucesso.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl border border-white/[.06] bg-[var(--althea-surface)] p-1">
            {([7, 30, 90] as const).map(days => (
              <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${period === days ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'text-[var(--althea-muted)] hover:text-white'}`}>
                {days} dias
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(false)} disabled={refreshing} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.06] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white disabled:opacity-50" aria-label="Atualizar">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">{error}</div>}

      <section className={`rounded-2xl border p-4 sm:p-5 ${runtimeReady ? 'border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.035)]' : 'border-[rgba(212,175,55,.16)] bg-[rgba(212,175,55,.035)]'}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${runtimeReady ? 'bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'bg-[rgba(212,175,55,.08)] text-[#D4AF37]'}`}>
              {runtimeReady ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">{runtimeReady ? 'Runtime de Recovery disponível' : automationEnabled ? 'Recovery bloqueado por falta de canal ativo' : 'Automação de carrinho desativada'}</h2>
              <p className="mt-1 max-w-3xl text-[10px] leading-5 text-[var(--althea-muted)]">
                {runtimeReady
                  ? `${accounts.length} conta(s) ativa(s): ${accounts.map(account => account.channel).join(', ')}. Cada checkout ainda precisa ter consentimento explícito e destino válido antes do envio.`
                  : automationEnabled
                    ? 'O scheduler e o worker estão ativos, mas nenhuma mensagem será enviada até existir uma conta real de WhatsApp, e-mail ou SMS conectada.'
                    : 'O motor está implantado, porém não cria disparos automáticos enquanto a automação de carrinho não for habilitada nas configurações.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/settings/recuperacao" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.07] px-3 text-[10px] font-semibold text-zinc-300 hover:bg-white/[.03]">
              <Settings2 size={13} /> Configurar Recovery
            </Link>
            <Link href="/dashboard/integration-hub" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.07] px-3 text-[10px] font-semibold text-zinc-300 hover:bg-white/[.03]">
              <CreditCard size={13} /> Conectar canais
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <Metric icon={WalletCards} label="Abandonados" value={String(metrics.abandoned)} />
        <Metric icon={CreditCard} label="Valor abandonado" value={money(metrics.abandoned_value)} />
        <Metric icon={Clock3} label="Na operação" value={String(metrics.queued)} />
        <Metric icon={Zap} label="Enviados" value={String(metrics.sent)} />
        <Metric icon={CheckCircle2} label="Recuperados" value={String(metrics.recovered)} success={metrics.recovered > 0} />
        <Metric icon={WalletCards} label="Receita recuperada" value={money(metrics.recovered_value)} success={metrics.recovered_value > 0} />
        <Metric icon={AlertTriangle} label="Bloqueados" value={String(metrics.blocked)} warning={metrics.blocked > 0} />
        <Metric icon={XCircle} label="Falhas" value={String(metrics.failed)} warning={metrics.failed > 0} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-sm font-semibold text-white">Pipeline de checkout</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Estado real do recovery automático e manual.</p></div>
          <RotateCcw size={17} className="text-[var(--althea-brand)]" />
        </div>
        <div className="mt-5 overflow-x-auto">
          {loading ? <Skeleton /> : (payload?.checkouts ?? []).length === 0 ? <Empty title="Nenhum checkout em Recovery" description="Quando houver abandono real e configuração elegível, ele aparecerá aqui." /> : (
            <table className="w-full min-w-[1220px] text-left">
              <thead><tr className="border-b border-white/[.05] text-[8px] uppercase tracking-wider text-[var(--althea-muted)]">
                <th className="pb-3 pr-4">Cliente / checkout</th><th className="pb-3 pr-4">Funil / produto</th><th className="pb-3 pr-4">Valor</th><th className="pb-3 pr-4">Recovery</th><th className="pb-3 pr-4">Canal</th><th className="pb-3 pr-4">Tentativas</th><th className="pb-3 pr-4">Última ação</th><th className="pb-3 pr-4">Diagnóstico</th><th className="pb-3 text-right">Ação</th>
              </tr></thead>
              <tbody>{(payload?.checkouts ?? []).map(row => {
                const state = row.recovery_status || row.event_status || 'pending'
                const canRequeue = row.status !== 'completed' && row.recovery_count < 5 && !['queued', 'processing', 'queued_delivery', 'processing_delivery'].includes(state)
                return (
                  <tr key={row.checkout_id} className="border-b border-white/[.035] last:border-0">
                    <td className="py-3.5 pr-4"><b className="block max-w-[220px] truncate text-[10px] text-zinc-200">{customerName(obj(row.customer))}</b><span className="mt-1 block max-w-[240px] truncate font-mono text-[8px] text-[var(--althea-muted)]">{row.checkout_id}</span></td>
                    <td className="py-3.5 pr-4"><span className="block max-w-[190px] truncate text-[10px] text-zinc-300">{row.funnel_name || row.funnel_id || '—'}</span><span className="mt-1 block max-w-[190px] truncate text-[8px] text-[var(--althea-muted)]">{row.product_name || row.product_id || '—'}</span></td>
                    <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(row.amount, row.currency)}</td>
                    <td className="py-3.5 pr-4"><Badge status={state} /></td>
                    <td className="py-3.5 pr-4 text-[9px] text-zinc-300">{row.channel || '—'}</td>
                    <td className="py-3.5 pr-4 text-[9px] text-zinc-300">{row.recovery_count}/5 <span className="text-[var(--althea-muted)]">· worker {row.event_attempt_count ?? 0}</span></td>
                    <td className="py-3.5 pr-4 text-[9px] text-[var(--althea-muted)]">{dateTime(row.recovery_last_sent_at || row.outbox_updated_at || row.abandoned_at || row.created_at)}</td>
                    <td className="py-3.5 pr-4"><span title={row.last_error || ''} className={`block max-w-[240px] truncate text-[9px] ${row.last_error ? 'text-red-300' : 'text-[var(--althea-muted)]'}`}>{row.last_error || row.outbox_status || 'sem erro registrado'}</span></td>
                    <td className="py-3.5 text-right"><button type="button" onClick={() => void requeue(row.checkout_id)} disabled={!canRequeue || Boolean(working)} className="rounded-lg border border-white/[.06] px-2.5 py-2 text-[9px] text-zinc-300 hover:bg-white/[.03] disabled:cursor-not-allowed disabled:opacity-35">{working === row.checkout_id ? 'Enfileirando...' : 'Reprocessar'}</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-sm font-semibold text-white">Oportunidades do CRM</h2><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Eventos financeiros/checkout ainda não processados pelo fluxo de atendimento.</p></div>
          <UserRound size={17} className="text-[var(--althea-brand)]" />
        </div>
        <div className="mt-4 space-y-2">
          {(payload?.crm_opportunities ?? []).length === 0 ? <Empty title="Fila CRM limpa" description="Nenhuma oportunidade pendente no período." /> : (payload?.crm_opportunities ?? []).slice(0, 50).map(opportunity => (
            <article key={opportunity.event_id} className="flex flex-col gap-3 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[8px] font-semibold ${opportunity.priority >= 80 ? 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.07)] text-[var(--althea-brand)]' : 'border-white/[.06] text-[var(--althea-muted)]'}`}>Prioridade {opportunity.priority}</span><span className="text-[8px] text-[var(--althea-muted)]">{opportunity.opportunity_type.replaceAll('_', ' ')}</span></div>
                <b className="mt-2 block truncate text-[10px] text-zinc-200">{opportunity.buyer_name || opportunity.buyer_email || 'Cliente não identificado'}</b>
                <p className="mt-1 text-[9px] leading-4 text-[var(--althea-muted)]">{opportunity.next_action}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] font-semibold text-white">{money(opportunity.amount, opportunity.currency || 'BRL')}</span>
                <button type="button" onClick={() => void executeOpportunity(opportunity.event_id)} disabled={Boolean(working)} className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] px-3 py-2 text-[9px] font-semibold text-[var(--althea-brand)] disabled:opacity-40">
                  {working === opportunity.event_id ? 'Processando...' : <>Acionar CRM <ChevronRight size={11} /></>}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function Metric({ icon: Icon, label, value, warning = false, success = false }: { icon: typeof WalletCards; label: string; value: string; warning?: boolean; success?: boolean }) {
  return <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><div className="flex items-center justify-between gap-2"><span className="text-[9px] text-[var(--althea-muted)]">{label}</span><Icon size={14} className={warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-[#718079]'} /></div><strong className={`mt-4 block text-[20px] font-semibold ${warning ? 'text-[#D4AF37]' : success ? 'text-[var(--althea-brand)]' : 'text-white'}`}>{value}</strong></article>
}

function Badge({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-semibold ${badgeClass(status)}`}>{statusLabels[status] || status}</span>
}

function Skeleton() {
  return <div className="space-y-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}</div>
}

function Empty({ title, description }: { title: string; description: string }) {
  return <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] px-5 text-center"><div><ShieldCheck size={21} className="mx-auto text-[var(--althea-brand)] opacity-60" /><b className="mt-2 block text-[10px] text-zinc-200">{title}</b><p className="mt-1 text-[9px] text-[var(--althea-muted)]">{description}</p></div></div>
}
