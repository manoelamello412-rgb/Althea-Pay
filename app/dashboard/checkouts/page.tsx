'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  X,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Cursor = { created_at: string; id: string } | null
type Funnel = { id: string; nome: string }
type CheckoutRow = {
  id: string
  funnel_id: string | null
  product_id: string | null
  funnel_name: string | null
  product_name: string | null
  status: string
  currency: string | null
  amount: number | string | null
  customer: Json | null
  attribution: Json | null
  created_at: string
  updated_at: string
  recovery_count: number | null
  recovery_status: string | null
  transaction_id: string | null
  payment_status: string | null
  gateway_id: string | null
  gateway_name: string | null
  gateway_provider: string | null
  provider_external_id: string | null
  failure_code: string | null
  payment_error: string | null
}
type CheckoutMetrics = {
  total: number
  active: number
  completed: number
  abandoned: number
  failed: number
  amount: number
}
type CheckoutPagePayload = {
  items: CheckoutRow[]
  metrics: CheckoutMetrics
  has_more: boolean
  next_cursor: Cursor
}
type CheckoutDetail = {
  checkout: Json
  transactions: Json[]
  attempts: Json[]
  events: Json[]
  webhooks: Json[]
  recovery: Json[]
  sales: Json[]
  conversations: Json[]
}

const EMPTY_METRICS: CheckoutMetrics = { total: 0, active: 0, completed: 0, abandoned: 0, failed: 0, amount: 0 }

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
  return txt(data.name ?? data.full_name ?? data.nome ?? data.email ?? data.phone) || 'Cliente não identificado'
}
function statusLabel(status: string | null): string {
  const value = (status || '').toLowerCase()
  return ({
    started: 'Iniciado',
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluído',
    abandoned: 'Abandonado',
    failed: 'Falhou',
    approved: 'Aprovado',
    created: 'Criado',
    refunded: 'Reembolsado',
    chargeback: 'Chargeback',
  } as Record<string, string>)[value] || status || '—'
}
function statusClass(status: string | null): string {
  const value = (status || '').toLowerCase()
  if (['completed', 'approved'].includes(value)) return 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]'
  if (['failed', 'chargeback'].includes(value)) return 'border-red-400/15 bg-red-400/[.06] text-red-300'
  if (value === 'abandoned') return 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]'
  if (['processing', 'pending', 'created'].includes(value)) return 'border-sky-400/15 bg-sky-400/[.06] text-sky-300'
  return 'border-white/[.06] bg-white/[.025] text-[var(--althea-muted)]'
}

export default function CheckoutsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [rows, setRows] = useState<CheckoutRow[]>([])
  const [metrics, setMetrics] = useState<CheckoutMetrics>(EMPTY_METRICS)
  const [cursor, setCursor] = useState<Cursor>(null)
  const [hasMore, setHasMore] = useState(false)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [funnelId, setFunnelId] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CheckoutDetail | null>(null)
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
      const funnelResult = await db.from('funnels')
        .select('id,nome')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('nome')
      if (!cancelled && !funnelResult.error) setFunnels((funnelResult.data ?? []) as Funnel[])
    })()
    return () => { cancelled = true }
  }, [db, router])

  const loadPage = useCallback(async (append = false) => {
    if (append) setLoadingMore(true)
    else if (!refreshing) setLoading(true)
    setError('')
    try {
      const activeCursor = append ? cursor : null
      const result = await db.rpc('checkout_operations_page_v1', {
        p_limit: 50,
        p_cursor_created_at: activeCursor?.created_at ?? null,
        p_cursor_id: activeCursor?.id ?? null,
        p_status: status === 'all' ? null : status,
        p_query: query || null,
        p_funnel_id: funnelId === 'all' ? null : funnelId,
      })
      if (result.error) throw result.error
      const payload = obj(result.data) as CheckoutPagePayload
      const items = Array.isArray(payload.items) ? payload.items as CheckoutRow[] : []
      setRows(previous => append ? [...previous, ...items] : items)
      setMetrics(obj(payload.metrics) as CheckoutMetrics)
      setHasMore(Boolean(payload.has_more))
      setCursor(payload.next_cursor && typeof payload.next_cursor === 'object' ? payload.next_cursor as Cursor : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os checkouts.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
  }, [cursor, db, funnelId, query, refreshing, status])

  useEffect(() => {
    if (!organizationId) return
    setCursor(null)
    void loadPage(false)
  }, [funnelId, organizationId, query, status])

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
    const channel = db.channel(`checkout-operations-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `organization_id=eq.${organizationId}` }, queueRefresh)
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
    void db.rpc('checkout_operations_detail_v1', { p_checkout_id: selectedId }).then(result => {
      if (!active) return
      if (result.error) setError(result.error.message)
      else {
        const data = obj(result.data)
        setDetail({
          checkout: obj(data.checkout),
          transactions: arr(data.transactions),
          attempts: arr(data.attempts),
          events: arr(data.events),
          webhooks: arr(data.webhooks),
          recovery: arr(data.recovery),
          sales: arr(data.sales),
          conversations: arr(data.conversations),
        })
      }
      setDetailLoading(false)
    })
    return () => { active = false }
  }, [db, selectedId])

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Jornada de compra</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Checkouts</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Visão operacional paginada de sessões, pagamento, gateway, recuperação e atendimento — sem carregar o histórico inteiro no navegador.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Atualizar
        </button>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={ShoppingCart} label="Sessões" value={String(metrics.total || 0)} />
        <Metric icon={Clock3} label="Em andamento" value={String(metrics.active || 0)} />
        <Metric icon={CheckCircle2} label="Concluídos" value={String(metrics.completed || 0)} />
        <Metric icon={XCircle} label="Abandonados" value={String(metrics.abandoned || 0)} warning={metrics.abandoned > 0} />
        <Metric icon={CreditCard} label="Valor registrado" value={money(metrics.amount)} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_240px]">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
            <Search size={14} className="text-[var(--althea-muted)]" />
            <input value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="Cliente, checkout, gateway, produto ou campanha..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]" />
          </label>
          <select value={status} onChange={event => setStatus(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os status</option>
            <option value="started">Iniciados</option><option value="pending">Pendentes</option><option value="processing">Processando</option>
            <option value="completed">Concluídos</option><option value="abandoned">Abandonados</option><option value="failed">Falhos</option>
          </select>
          <select value={funnelId} onChange={event => setFunnelId(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os funis</option>
            {funnels.map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? <Skeleton /> : rows.length === 0 ? (
            <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] px-6 text-center">
              <div><ShoppingCart size={24} className="mx-auto text-[var(--althea-brand)] opacity-60" /><p className="mt-3 text-sm font-medium text-white">Nenhum checkout encontrado</p><p className="mt-1 text-[10px] text-[var(--althea-muted)]">Ajuste os filtros ou aguarde novas sessões reais.</p></div>
            </div>
          ) : (
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead><tr className="border-b border-white/[.05] text-[9px] text-[var(--althea-muted)]">
                <th className="pb-3 pr-4 font-medium">Cliente</th><th className="pb-3 pr-4 font-medium">Funil / produto</th>
                <th className="pb-3 pr-4 font-medium">Valor</th><th className="pb-3 pr-4 font-medium">Checkout</th>
                <th className="pb-3 pr-4 font-medium">Pagamento</th><th className="pb-3 pr-4 font-medium">Gateway</th>
                <th className="pb-3 pr-4 font-medium">Atualizado</th><th className="pb-3 text-right font-medium">Detalhe</th>
              </tr></thead>
              <tbody>{rows.map(row => (
                <tr key={row.id} className="border-b border-white/[.035] last:border-0 transition hover:bg-white/[.018]">
                  <td className="py-3.5 pr-4"><strong className="block max-w-[230px] truncate text-[10px] text-white">{customerName(row.customer)}</strong><span className="mt-1 block max-w-[240px] truncate text-[8px] text-[var(--althea-muted)]">{txt(obj(row.customer).email) || row.id}</span></td>
                  <td className="py-3.5 pr-4"><span className="block text-[10px] text-zinc-300">{row.funnel_name || '—'}</span><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{row.product_name || 'Produto não informado'}</span></td>
                  <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(row.amount, row.currency || 'BRL')}</td>
                  <td className="py-3.5 pr-4"><Badge value={row.status} /></td>
                  <td className="py-3.5 pr-4"><Badge value={row.payment_status} /></td>
                  <td className="py-3.5 pr-4"><span className="block text-[10px] text-zinc-300">{row.gateway_name || row.gateway_id || '—'}</span><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{row.gateway_provider || 'não vinculado'}</span></td>
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
          <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-white/[.07] bg-[#090d0b] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[9px] uppercase tracking-[.18em] text-[var(--althea-brand)]">Checkout 360</p><h2 className="mt-1 text-xl font-semibold text-white">{detail ? customerName(obj(detail.checkout.customer)) : 'Carregando...'}</h2><p className="mt-1 max-w-lg truncate text-[10px] text-[var(--althea-muted)]">{selectedId}</p></div>
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-[var(--althea-muted)] hover:bg-white/5 hover:text-white"><X size={18} /></button>
            </div>

            {detailLoading || !detail ? <div className="mt-8"><Skeleton /></div> : (
              <div className="mt-6 space-y-4">
                <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Status" value={statusLabel(txt(detail.checkout.status))} />
                  <Detail label="Valor" value={money(detail.checkout.amount, txt(detail.checkout.currency) || 'BRL')} />
                  <Detail label="Funil" value={txt(detail.checkout.funnel_name) || '—'} />
                  <Detail label="Produto" value={txt(detail.checkout.product_name) || '—'} />
                </section>

                <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
                  <Title icon={CreditCard} text="Transações e tentativas" />
                  <div className="mt-3 space-y-2">
                    {detail.transactions.length === 0 ? <Empty text="Nenhuma transação vinculada." /> : detail.transactions.map((item, index) => (
                      <div key={txt(item.id) || index} className="rounded-xl border border-white/[.05] bg-black/10 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-xs text-white">{txt(item.gateway_name) || txt(item.gateway_provider) || txt(item.gateway_id) || 'Gateway não informado'}</strong><p className="mt-1 text-[9px] text-[var(--althea-muted)]">{txt(item.external_id) || txt(item.id)}</p></div><Badge value={txt(item.status)} /></div>
                        {(txt(item.failure_code) || txt(item.error_message)) && <p className="mt-2 text-[10px] text-red-300">{txt(item.failure_code)} {txt(item.error_message)}</p>}
                      </div>
                    ))}
                    {detail.attempts.length > 0 && <p className="pt-1 text-[9px] text-[var(--althea-muted)]">{detail.attempts.length} tentativa(s) registrada(s) no roteamento.</p>}
                  </div>
                </section>

                <section className="grid gap-3 lg:grid-cols-2">
                  <Panel icon={Activity} title="Eventos do checkout" items={detail.events} primary="event_type" dateKey="created_at" />
                  <Panel icon={RotateCcw} title="Recuperação" items={detail.recovery} primary="event_type" secondary="status" dateKey="created_at" />
                  <Panel icon={MessageCircle} title="Atendimento vinculado" items={detail.conversations} primary="buyer_name" secondary="primary_channel" dateKey="updated_at" />
                  <Panel icon={Activity} title="Webhooks financeiros" items={detail.webhooks} primary="provider" secondary="status" dateKey="received_at" />
                </section>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof ShoppingCart; label: string; value: string; warning?: boolean }) {
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
function Title({ icon: Icon, text }: { icon: typeof Activity; text: string }) {
  return <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--althea-muted)]"><Icon size={13} /> {text}</div>
}
function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-white/[.05] p-4 text-center text-[10px] text-[var(--althea-muted)]">{text}</p>
}
function Panel({ icon: Icon, title, items, primary, secondary, dateKey }: { icon: typeof Activity; title: string; items: Json[]; primary: string; secondary?: string; dateKey: string }) {
  return <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4"><Title icon={Icon} text={title} /><div className="mt-3 space-y-2">{items.length === 0 ? <Empty text="Nenhum registro." /> : items.slice(0, 20).map((item, index) => <div key={txt(item.id) || index} className="rounded-xl border border-white/[.045] bg-black/10 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><strong className="truncate text-[10px] text-zinc-200">{txt(item[primary]) || 'Registro'}</strong><span className="shrink-0 text-[8px] text-[var(--althea-muted)]">{dateTime(item[dateKey])}</span></div>{secondary && txt(item[secondary]) && <p className="mt-1 text-[9px] text-[var(--althea-muted)]">{txt(item[secondary])}</p>}</div>)}</div></section>
}
