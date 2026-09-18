'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileSearch,
  Landmark,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Cursor = { created_at: string; id: string } | null
type Funnel = { id: string; nome: string }
type Gateway = { id: string; display_name: string | null; provider: string | null }
type PaymentRow = {
  id: string
  funnel_id: string | null
  product_id: string | null
  gateway_id: string | null
  external_id: string | null
  amount: number | string
  currency: string
  status: string
  customer: Json | null
  error_message: string | null
  failure_code: string | null
  attempt_count: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
  funnel_name: string | null
  product_name: string | null
  gateway_name: string | null
  gateway_provider: string | null
  gateway_environment: string | null
  last_attempt_status: string | null
  last_failure_class: string | null
  last_decision_reason: string | null
  last_duration_ms: number | null
  last_provider_request_id: string | null
}
type PaymentMetrics = {
  transactions: number
  gross_volume: number
  approved_count: number
  approved_volume: number
  pending_count: number
  failed_count: number
  refunded_count: number
  chargeback_count: number
}
type PaymentPagePayload = {
  items: PaymentRow[]
  metrics: PaymentMetrics
  has_more: boolean
  next_cursor: Cursor
}
type PaymentDetail = {
  transaction: Json
  attempts: Json[]
  webhooks: Json[]
  refunds: Json[]
  disputes: Json[]
  reconciliation: Json[]
  audit: Json[]
  financial_journals: Json[]
  sale: Json | null
  checkout: Json | null
  conversations: Json[]
}

const EMPTY_METRICS: PaymentMetrics = {
  transactions: 0,
  gross_volume: 0,
  approved_count: 0,
  approved_volume: 0,
  pending_count: 0,
  failed_count: 0,
  refunded_count: 0,
  chargeback_count: 0,
}

function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}
function arr(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Json[] : []
}
function txt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
}
function num(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
function money(value: unknown, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(num(value))
}
function dateTime(value: unknown): string {
  const parsed = new Date(txt(value))
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}
function customerName(customer: Json | null): string {
  const data = obj(customer)
  return txt(data.name ?? data.full_name ?? data.email ?? data.phone) || 'Cliente não identificado'
}
function statusLabel(status: string | null): string {
  const value = (status || '').toLowerCase()
  return ({
    created: 'Criada',
    pending: 'Pendente',
    processing: 'Processando',
    approved: 'Aprovada',
    failed: 'Falhou',
    refunded: 'Reembolsada',
    chargeback: 'Chargeback',
    declined: 'Recusada',
    unknown: 'Indefinido',
    open: 'Aberto',
    matched: 'Conciliado',
    mismatch: 'Divergência',
  } as Record<string, string>)[value] || status || '—'
}
function statusClass(status: string | null): string {
  const value = (status || '').toLowerCase()
  if (['approved', 'matched', 'completed'].includes(value)) return 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]'
  if (['failed', 'declined', 'chargeback', 'mismatch'].includes(value)) return 'border-red-400/15 bg-red-400/[.06] text-red-300'
  if (['refunded'].includes(value)) return 'border-fuchsia-400/15 bg-fuchsia-400/[.06] text-fuchsia-300'
  if (['created', 'pending', 'processing', 'open'].includes(value)) return 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]'
  return 'border-white/[.06] bg-white/[.025] text-[var(--althea-muted)]'
}

export default function PagamentosPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [metrics, setMetrics] = useState<PaymentMetrics>(EMPTY_METRICS)
  const [cursor, setCursor] = useState<Cursor>(null)
  const [hasMore, setHasMore] = useState(false)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [funnelId, setFunnelId] = useState('all')
  const [gatewayId, setGatewayId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PaymentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError || !auth.user) {
        router.replace('/login')
        return
      }
      const { data: profile, error: profileError } = await db.from('profiles')
        .select('default_organization_id')
        .eq('id', auth.user.id)
        .single()
      if (cancelled) return
      if (profileError || !profile?.default_organization_id) {
        setError('Organização ativa não encontrada para esta conta.')
        setLoading(false)
        return
      }
      const orgId = String(profile.default_organization_id)
      setOrganizationId(orgId)
      const [funnelResult, gatewayResult] = await Promise.all([
        db.from('funnels').select('id,nome').eq('organization_id', orgId).is('deleted_at', null).order('nome'),
        db.from('gateways').select('id,display_name,provider').eq('organization_id', orgId).order('display_name'),
      ])
      if (!cancelled && !funnelResult.error) setFunnels((funnelResult.data ?? []) as Funnel[])
      if (!cancelled && !gatewayResult.error) setGateways((gatewayResult.data ?? []) as Gateway[])
    })()
    return () => { cancelled = true }
  }, [db, router])

  const loadPage = useCallback(async (append = false) => {
    if (append) setLoadingMore(true)
    else if (!refreshing) setLoading(true)
    setError('')
    try {
      const activeCursor = append ? cursor : null
      const result = await db.rpc('payment_operations_page_v1', {
        p_limit: 50,
        p_cursor_created_at: activeCursor?.created_at ?? null,
        p_cursor_id: activeCursor?.id ?? null,
        p_status: status === 'all' ? null : status,
        p_query: query || null,
        p_funnel_id: funnelId === 'all' ? null : funnelId,
        p_gateway_id: gatewayId === 'all' ? null : gatewayId,
      })
      if (result.error) throw result.error
      const payload = obj(result.data) as PaymentPagePayload
      const items = Array.isArray(payload.items) ? payload.items as PaymentRow[] : []
      setRows(previous => append ? [...previous, ...items] : items)
      setMetrics(obj(payload.metrics) as PaymentMetrics)
      setHasMore(Boolean(payload.has_more))
      setCursor(payload.next_cursor && typeof payload.next_cursor === 'object' ? payload.next_cursor as Cursor : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os pagamentos.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
  }, [cursor, db, funnelId, gatewayId, query, refreshing, status])

  useEffect(() => {
    if (!organizationId) return
    setCursor(null)
    void loadPage(false)
  }, [funnelId, gatewayId, organizationId, query, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setCursor(null)
    await loadPage(false)
  }, [loadPage])

  useEffect(() => {
    if (!organizationId) return
    let active = true
    let timer: number | null = null
    const queueRefresh = () => {
      if (!active || timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void refresh()
      }, 500)
    }
    const channel = db.channel(`payment-operations-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_payment_attempts', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .subscribe()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, organizationId, refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let active = true
    setDetailLoading(true)
    void db.rpc('payment_operations_detail_v1', { p_transaction_id: selectedId }).then(result => {
      if (!active) return
      if (result.error) setError(result.error.message)
      else {
        const data = obj(result.data)
        setDetail({
          transaction: obj(data.transaction),
          attempts: arr(data.attempts),
          webhooks: arr(data.webhooks),
          refunds: arr(data.refunds),
          disputes: arr(data.disputes),
          reconciliation: arr(data.reconciliation),
          audit: arr(data.audit),
          financial_journals: arr(data.financial_journals),
          sale: Object.keys(obj(data.sale)).length ? obj(data.sale) : null,
          checkout: Object.keys(obj(data.checkout)).length ? obj(data.checkout) : null,
          conversations: arr(data.conversations),
        })
      }
      setDetailLoading(false)
    })
    return () => { active = false }
  }, [db, selectedId])

  const exceptions = (metrics.failed_count || 0) + (metrics.chargeback_count || 0)

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Operação financeira</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Pagamentos</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Transações paginadas no servidor com tentativas, roteamento, webhooks, conciliação, estornos, disputas e auditoria em um único detalhe operacional.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Atualizar
        </button>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={CircleDollarSign} label="Volume registrado" value={money(metrics.gross_volume)} />
        <Metric icon={CheckCircle2} label="Volume aprovado" value={money(metrics.approved_volume)} />
        <Metric icon={CreditCard} label="Aprovadas" value={String(metrics.approved_count || 0)} />
        <Metric icon={Clock3} label="Pendentes" value={String(metrics.pending_count || 0)} />
        <Metric icon={AlertTriangle} label="Exceções" value={String(exceptions)} warning={exceptions > 0} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_220px_220px]">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
            <Search size={14} className="text-[var(--althea-muted)]" />
            <input value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="Cliente, transação, gateway, erro ou decisão..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]" />
          </label>
          <select value={status} onChange={event => setStatus(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os status</option><option value="approved">Aprovadas</option><option value="pending">Pendentes</option>
            <option value="created">Criadas</option><option value="failed">Falhas</option><option value="refunded">Reembolsadas</option><option value="chargeback">Chargebacks</option>
          </select>
          <select value={funnelId} onChange={event => setFunnelId(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os funis</option>{funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}
          </select>
          <select value={gatewayId} onChange={event => setGatewayId(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os gateways</option>{gateways.map(gateway => <option key={gateway.id} value={gateway.id}>{gateway.display_name || gateway.provider || gateway.id}</option>)}
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? <Skeleton /> : rows.length === 0 ? (
            <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] px-6 text-center">
              <div><CreditCard size={24} className="mx-auto text-[var(--althea-brand)] opacity-60" /><p className="mt-3 text-sm font-medium text-white">Nenhum pagamento encontrado</p><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Ajuste os filtros ou aguarde novas transações reais.</p></div>
            </div>
          ) : (
            <table className="w-full min-w-[1280px] border-collapse text-left">
              <thead><tr className="border-b border-white/[.05] text-[9px] text-[var(--althea-muted)]">
                <th className="pb-3 pr-4 font-medium">Cliente / transação</th><th className="pb-3 pr-4 font-medium">Valor</th>
                <th className="pb-3 pr-4 font-medium">Gateway</th><th className="pb-3 pr-4 font-medium">Funil</th>
                <th className="pb-3 pr-4 font-medium">Status</th><th className="pb-3 pr-4 font-medium">Última tentativa</th>
                <th className="pb-3 pr-4 font-medium">Latência</th><th className="pb-3 pr-4 font-medium">Atualizado</th><th className="pb-3 text-right font-medium">Detalhe</th>
              </tr></thead>
              <tbody>{rows.map(row => (
                <tr key={row.id} className="border-b border-white/[.035] last:border-0 transition hover:bg-white/[.018]">
                  <td className="py-3.5 pr-4"><strong className="block max-w-[230px] truncate text-[10px] text-white">{customerName(row.customer)}</strong><span className="mt-1 block max-w-[260px] truncate text-[8px] text-[var(--althea-muted)]">{row.external_id || row.id}</span></td>
                  <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(row.amount, row.currency)}</td>
                  <td className="py-3.5 pr-4"><span className="block text-[10px] text-zinc-300">{row.gateway_name || row.gateway_id || '—'}</span><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{[row.gateway_provider,row.gateway_environment].filter(Boolean).join(' · ') || '—'}</span></td>
                  <td className="py-3.5 pr-4"><span className="block max-w-[190px] truncate text-[10px] text-zinc-300">{row.funnel_name || '—'}</span><span className="mt-1 block max-w-[190px] truncate text-[8px] text-[var(--althea-muted)]">{row.product_name || '—'}</span></td>
                  <td className="py-3.5 pr-4"><Badge value={row.status} /></td>
                  <td className="py-3.5 pr-4"><span className="block text-[9px] text-zinc-300">{statusLabel(row.last_attempt_status)}</span><span className="mt-1 block max-w-[190px] truncate text-[8px] text-[var(--althea-muted)]">{row.last_failure_class || row.last_decision_reason || 'sem exceção'}</span></td>
                  <td className="py-3.5 pr-4 text-[9px] text-[var(--althea-muted)]">{row.last_duration_ms == null ? '—' : `${row.last_duration_ms} ms`}</td>
                  <td className="py-3.5 pr-4 text-[9px] text-[var(--althea-muted)]">{dateTime(row.updated_at)}</td>
                  <td className="py-3.5 text-right"><button type="button" onClick={() => setSelectedId(row.id)} className="inline-flex items-center gap-1 rounded-lg border border-white/[.05] px-2.5 py-2 text-[9px] text-[var(--althea-muted)] hover:bg-white/[.025] hover:text-white">Abrir <ChevronRight size={12} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        {hasMore && <div className="mt-4 flex justify-center"><button type="button" onClick={() => void loadPage(true)} disabled={loadingMore} className="rounded-xl border border-white/[.06] px-4 py-2.5 text-[10px] text-[var(--althea-muted)] hover:text-white disabled:opacity-50">{loadingMore ? 'Carregando...' : 'Carregar mais 50'}</button></div>}
      </section>

      {selectedId && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[150] flex justify-end bg-black/70 backdrop-blur-sm" onClick={event => { if (event.currentTarget === event.target) setSelectedId(null) }}>
          <aside className="h-full w-full max-w-4xl overflow-y-auto border-l border-white/[.07] bg-[#090d0b] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[9px] uppercase tracking-[.18em] text-[var(--althea-brand)]">Payment 360</p><h2 className="mt-1 text-xl font-semibold text-white">{detail ? customerName(obj(detail.transaction.customer)) : 'Carregando...'}</h2><p className="mt-1 max-w-xl truncate text-[10px] text-[var(--althea-muted)]">{selectedId}</p></div>
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-[var(--althea-muted)] hover:bg-white/5 hover:text-white"><X size={18} /></button>
            </div>

            {detailLoading || !detail ? <div className="mt-8"><Skeleton /></div> : (
              <div className="mt-6 space-y-4">
                <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Detail label="Status" value={statusLabel(txt(detail.transaction.status))} />
                  <Detail label="Valor" value={money(detail.transaction.amount, txt(detail.transaction.currency) || 'BRL')} />
                  <Detail label="Gateway" value={txt(obj(detail.transaction.gateway).name) || txt(obj(detail.transaction.gateway).provider) || txt(detail.transaction.gateway_id) || '—'} />
                  <Detail label="Tentativas" value={String(num(detail.transaction.attempt_count))} />
                  <Detail label="Criada em" value={dateTime(detail.transaction.created_at)} />
                </section>

                {(txt(detail.transaction.failure_code) || txt(detail.transaction.error_message)) && (
                  <section className="rounded-2xl border border-red-400/15 bg-red-400/[.045] p-4">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-red-300"><ShieldAlert size={14} /> Exceção financeira</div>
                    <p className="mt-2 text-xs text-red-100">{txt(detail.transaction.failure_code)} {txt(detail.transaction.error_message)}</p>
                  </section>
                )}

                <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
                  <Title icon={Activity} text="Tentativas e roteamento" />
                  <div className="mt-3 space-y-2">{detail.attempts.length === 0 ? <Empty text="Nenhuma tentativa registrada." /> : detail.attempts.map((item, index) => (
                    <div key={txt(item.id) || index} className="rounded-xl border border-white/[.05] bg-black/10 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><strong className="text-xs text-white">{txt(item.gateway_name) || txt(item.gateway_id) || 'Gateway'}</strong><p className="mt-1 text-[9px] text-[var(--althea-muted)]">tentativa #{txt(item.attempt_order) || String(index + 1)} · {txt(item.provider_request_id) || 'sem request id'}</p></div>
                        <Badge value={txt(item.status)} />
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <Mini label="Decisão" value={txt(item.decision_reason) || '—'} />
                        <Mini label="Falha" value={txt(item.failure_class) || txt(item.response_code) || '—'} />
                        <Mini label="Duração" value={item.duration_ms == null ? '—' : `${txt(item.duration_ms)} ms`} />
                      </div>
                    </div>
                  ))}</div>
                </section>

                <section className="grid gap-3 lg:grid-cols-2">
                  <Panel icon={Activity} title="Webhooks" items={detail.webhooks} primary="provider" secondary="status" dateKey="received_at" />
                  <Panel icon={FileSearch} title="Auditoria" items={detail.audit} primary="event_type" secondary="source" dateKey="created_at" />
                  <Panel icon={Landmark} title="Conciliação" items={detail.reconciliation} primary="status" secondary="mismatch_reason" dateKey="created_at" />
                  <Panel icon={RotateCcw} title="Estornos" items={detail.refunds} primary="status" secondary="failure_message" dateKey="created_at" />
                  <Panel icon={ShieldAlert} title="Disputas / chargebacks" items={detail.disputes} primary="status" secondary="reason" dateKey="created_at" />
                  <Panel icon={Landmark} title="Journals financeiros" items={detail.financial_journals} primary="journal_type" secondary="status" dateKey="created_at" />
                </section>

                <section className="grid gap-3 lg:grid-cols-3">
                  <LinkCard title="Checkout vinculado" value={detail.checkout ? txt(detail.checkout.id) : 'Nenhum'} subtitle={detail.checkout ? statusLabel(txt(detail.checkout.status)) : 'Sem checkout canônico'} />
                  <LinkCard title="Venda projetada" value={detail.sale ? txt(detail.sale.id) : 'Nenhuma'} subtitle={detail.sale ? statusLabel(txt(detail.sale.status)) : 'Sem sale projetada'} />
                  <LinkCard title="Conversas" value={String(detail.conversations.length)} subtitle={detail.conversations.length ? txt(detail.conversations[0].primary_channel) || 'CRM' : 'Sem conversa vinculada'} />
                </section>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof CreditCard; label: string; value: string; warning?: boolean }) {
  return <article className="min-h-[108px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><div className="flex items-center justify-between gap-3"><span className="text-[10px] text-[var(--althea-muted)]">{label}</span><Icon size={15} className={warning ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} /></div><strong className={`mt-4 block text-[22px] font-semibold ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}</strong></article>
}
function Badge({ value }: { value: string | null }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-semibold ${statusClass(value)}`}>{statusLabel(value)}</span>
}
function Skeleton() {
  return <div className="space-y-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}</div>
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.05] bg-[var(--althea-surface)] p-3"><span className="text-[9px] uppercase tracking-wider text-[var(--althea-muted)]">{label}</span><strong className="mt-1 block break-words text-xs text-white">{value}</strong></div>
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/[.04] px-2.5 py-2"><span className="text-[8px] text-[var(--althea-muted)]">{label}</span><p className="mt-1 break-words text-[9px] text-zinc-300">{value}</p></div>
}
function Title({ icon: Icon, text }: { icon: typeof Activity; text: string }) {
  return <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--althea-muted)]"><Icon size={13} /> {text}</div>
}
function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-white/[.05] p-4 text-center text-[10px] text-[var(--althea-muted)]">{text}</p>
}
function Panel({ icon: Icon, title, items, primary, secondary, dateKey }: { icon: typeof Activity; title: string; items: Json[]; primary: string; secondary?: string; dateKey: string }) {
  return <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><Title icon={Icon} text={title} /><div className="mt-3 space-y-2">{items.length === 0 ? <Empty text="Nenhum registro." /> : items.slice(0, 20).map((item, index) => <div key={txt(item.id) || index} className="rounded-xl border border-white/[.045] bg-black/10 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><strong className="truncate text-[10px] text-zinc-200">{txt(item[primary]) || 'Registro'}</strong><span className="shrink-0 text-[8px] text-[var(--althea-muted)]">{dateTime(item[dateKey])}</span></div>{secondary && txt(item[secondary]) && <p className="mt-1 text-[9px] text-[var(--althea-muted)]">{txt(item[secondary])}</p>}</div>)}</div></section>
}
function LinkCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><span className="text-[9px] uppercase tracking-wider text-[var(--althea-muted)]">{title}</span><strong className="mt-2 block truncate text-xs text-white">{value}</strong><p className="mt-1 text-[9px] text-[var(--althea-muted)]">{subtitle}</p></article>
}
