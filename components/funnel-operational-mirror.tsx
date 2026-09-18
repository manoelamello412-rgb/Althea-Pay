'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  HeartPulse,
  Loader2,
  MessageCircle,
  RefreshCw,
  Route,
  ShoppingCart,
  Workflow,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type OperationalEvent = {
  event_id: string
  organization_id: string
  user_id: string
  funnel_id: string
  source: string
  category: string
  event_type: string
  status: string | null
  severity: string
  amount: number | null
  currency: string | null
  checkout_id: string | null
  transaction_id: string | null
  gateway_id: string | null
  external_id: string | null
  message: string | null
  metadata: Record<string, unknown>
  occurred_at: string
}

type FilterKey = 'all' | 'payment' | 'checkout' | 'chat' | 'health'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Tudo' },
  { key: 'payment', label: 'Pagamentos' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'chat', label: 'Chat' },
  { key: 'health', label: 'Saúde & controle' },
]

function severityMeta(value: string) {
  if (value === 'error') return { dot: 'bg-rose-400', text: 'text-rose-300', border: 'border-rose-500/15' }
  if (value === 'warning') return { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/15' }
  if (value === 'success') return { dot: 'bg-[var(--althea-brand)]', text: 'text-[var(--althea-brand)]', border: 'border-[rgba(29,184,84,.14)]' }
  return { dot: 'bg-sky-400', text: 'text-sky-300', border: 'border-white/[.05]' }
}

function categoryLabel(value: string) {
  if (value === 'payment') return 'PAGAMENTO'
  if (value === 'checkout') return 'CHECKOUT'
  if (value === 'chat') return 'CHAT'
  if (value === 'sale') return 'VENDA'
  if (value === 'integration_health') return 'SAÚDE'
  if (value === 'gateway_control') return 'CONTROLE'
  return 'FUNIL'
}

function eventIcon(category: string) {
  if (category === 'payment') return <CreditCard className="h-3.5 w-3.5" />
  if (category === 'checkout') return <ShoppingCart className="h-3.5 w-3.5" />
  if (category === 'chat') return <MessageCircle className="h-3.5 w-3.5" />
  if (category === 'sale') return <CircleDollarSign className="h-3.5 w-3.5" />
  if (category === 'integration_health') return <HeartPulse className="h-3.5 w-3.5" />
  if (category === 'gateway_control') return <Route className="h-3.5 w-3.5" />
  return <Workflow className="h-3.5 w-3.5" />
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      maximumFractionDigits: 2,
    }).format(Number(amount))
  } catch {
    return String(amount)
  }
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function matchesFilter(event: OperationalEvent, filter: FilterKey) {
  if (filter === 'all') return true
  if (filter === 'payment') return event.category === 'payment' || event.category === 'sale'
  if (filter === 'checkout') return event.category === 'checkout'
  if (filter === 'chat') return event.category === 'chat'
  return event.category === 'integration_health' || event.category === 'gateway_control'
}

export function FunnelOperationalMirror({ funnelId }: { funnelId: string }) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [events, setEvents] = useState<OperationalEvent[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!funnelId) return
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError('')

    try {
      const result = await db
        .from('v_funnel_operational_timeline')
        .select('event_id,organization_id,user_id,funnel_id,source,category,event_type,status,severity,amount,currency,checkout_id,transaction_id,gateway_id,external_id,message,metadata,occurred_at')
        .eq('funnel_id', funnelId)
        .order('occurred_at', { ascending: false })
        .limit(80)

      if (result.error) throw result.error
      setEvents((result.data || []) as OperationalEvent[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o espelho operacional.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db, funnelId])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const visibleEvents = useMemo(
    () => events.filter(event => matchesFilter(event, filter)).slice(0, 40),
    [events, filter],
  )

  const last24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return events.filter(event => new Date(event.occurred_at).getTime() >= cutoff)
  }, [events])

  const incidentKey = (event: OperationalEvent) => {
    if (event.transaction_id) return 'transaction:' + event.transaction_id
    if (event.checkout_id) return 'checkout:' + event.checkout_id
    if (event.category === 'chat' && event.metadata?.conversation_id) {
      return 'chat:' + String(event.metadata.conversation_id) + ':' + (event.external_id || event.event_id)
    }
    if (event.external_id) return event.category + ':external:' + event.external_id
    return event.event_id
  }

  const issueCount = new Set(
    last24h.filter(event => event.severity === 'error').map(incidentKey),
  ).size
  const warningCount = new Set(
    last24h.filter(event => event.severity === 'warning').map(incidentKey),
  ).size
  const latestPayment = events.find(event => event.category === 'payment' || event.category === 'sale') || null
  const connector = events.find(event => event.event_type === 'connector_health') || null
  const hasCritical = issueCount > 0
  const hasWarning = warningCount > 0

  const overallLabel = hasCritical ? 'ATENÇÃO' : hasWarning ? 'MONITORAR' : events.length ? 'OPERACIONAL' : 'SEM DADOS'
  const overallTone = hasCritical ? 'text-rose-300' : hasWarning ? 'text-amber-300' : 'text-[var(--althea-brand)]'

  if (loading) {
    return (
      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-5">
        <div className="flex min-h-[180px] items-center justify-center gap-2 text-xs text-[var(--althea-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando espelho operacional...
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[.055] bg-[var(--althea-surface)]">
      <div className="border-b border-white/[.045] p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(29,184,84,.14)] bg-[rgba(29,184,84,.05)] text-[var(--althea-brand)]">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Espelho operacional</h2>
                <span className="rounded-full border border-white/[.05] bg-black/20 px-2 py-1 text-[7px] font-bold uppercase tracking-[.16em] text-[var(--althea-muted)]">
                  visão unificada
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-[var(--althea-muted)]">
                Checkout, pagamentos, tentativas de gateway, vendas, eventos do funil, chat, comandos e saúde da integração em uma única linha do tempo.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[8px] font-bold uppercase tracking-wider text-zinc-400 transition hover:text-white disabled:opacity-40"
          >
            <RefreshCw className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} />
            atualização 15s
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
            <span className="text-[8px] uppercase tracking-wider text-[var(--althea-muted)]">Estado geral</span>
            <div className="mt-2 flex items-center gap-2">
              {hasCritical ? <AlertTriangle className="h-4 w-4 text-rose-300" /> : <CheckCircle2 className="h-4 w-4 text-[var(--althea-brand)]" />}
              <strong className={'text-sm font-semibold ' + overallTone}>{overallLabel}</strong>
            </div>
          </article>

          <article className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
            <span className="text-[8px] uppercase tracking-wider text-[var(--althea-muted)]">Falhas · 24h</span>
            <strong className={'mt-2 block text-sm font-semibold ' + (issueCount ? 'text-rose-300' : 'text-white')}>{issueCount}</strong>
            <small className="mt-1 block text-[8px] text-[var(--althea-muted)]">{warningCount} alerta(s)</small>
          </article>

          <article className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
            <span className="text-[8px] uppercase tracking-wider text-[var(--althea-muted)]">Último pagamento</span>
            <strong className="mt-2 block truncate text-sm font-semibold text-white">{latestPayment?.status || '—'}</strong>
            <small className="mt-1 block truncate text-[8px] text-[var(--althea-muted)]">
              {latestPayment ? formatMoney(latestPayment.amount, latestPayment.currency) : 'Nenhum pagamento espelhado'}
            </small>
          </article>

          <article className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
            <span className="text-[8px] uppercase tracking-wider text-[var(--althea-muted)]">Conector</span>
            <strong className="mt-2 block truncate text-sm font-semibold text-white">{connector?.status || '—'}</strong>
            <small className="mt-1 block truncate text-[8px] text-[var(--althea-muted)]">
              {connector ? formatTime(connector.occurred_at) : 'Aguardando conexão'}
            </small>
          </article>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {FILTERS.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={
                'rounded-lg border px-2.5 py-1.5 text-[8px] font-semibold transition ' +
                (filter === item.key
                  ? 'border-[rgba(29,184,84,.2)] bg-[rgba(29,184,84,.07)] text-[var(--althea-brand)]'
                  : 'border-white/[.045] bg-black/10 text-[var(--althea-muted)] hover:text-white')
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="m-4 rounded-xl border border-rose-500/15 bg-rose-950/10 p-3 text-[10px] text-rose-300 sm:m-5">
          {error}
        </div>
      )}

      {!error && visibleEvents.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center px-5 py-10 text-center">
          <div>
            <Workflow className="mx-auto h-5 w-5 text-[var(--althea-brand)]" />
            <p className="mt-3 text-xs font-semibold text-white">Aguardando atividade</p>
            <p className="mt-1 max-w-md text-[9px] leading-relaxed text-[var(--althea-muted)]">
              Assim que este funil receber eventos, checkouts, pagamentos ou alterações operacionais, tudo aparecerá aqui em ordem cronológica.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-white/[.035]">
          {visibleEvents.map(event => {
            const meta = severityMeta(event.severity)
            return (
              <article key={event.event_id} className="p-4 transition hover:bg-white/[.012] sm:px-5">
                <div className="flex items-start gap-3">
                  <div className={'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-black/15 ' + meta.border + ' ' + meta.text}>
                    {eventIcon(event.category)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={'h-1.5 w-1.5 rounded-full ' + meta.dot} />
                      <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--althea-muted)]">{categoryLabel(event.category)}</span>
                      <span className="text-[10px] font-semibold text-white">{event.event_type.replaceAll('_', ' ')}</span>
                      {event.status && (
                        <span className={'rounded-md border border-white/[.045] px-1.5 py-0.5 text-[7px] font-bold uppercase ' + meta.text}>
                          {event.status}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-[var(--althea-muted)]">
                      <time>{formatTime(event.occurred_at)}</time>
                      {event.amount != null && <span>{formatMoney(event.amount, event.currency)}</span>}
                      {event.gateway_id && <span>Gateway: {event.gateway_id}</span>}
                      {event.checkout_id && <span>Checkout: {event.checkout_id.slice(0, 12)}</span>}
                      {event.transaction_id && <span>Transação: {event.transaction_id.slice(0, 12)}</span>}
                    </div>

                    {event.message && (
                      <p className={'mt-2 text-[9px] leading-relaxed ' + (event.severity === 'error' ? 'text-rose-300' : 'text-zinc-400')}>
                        {event.message}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
