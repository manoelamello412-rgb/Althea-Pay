'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, Search, ShoppingCart, XCircle } from 'lucide-react'

type CheckoutStatus = 'started' | 'pending' | 'processing' | 'completed' | 'abandoned' | 'failed' | string
type PaymentStatus = 'created' | 'pending' | 'approved' | 'failed' | 'refunded' | 'chargeback' | string

type CheckoutOperation = {
  id: string
  funnel_id: string | null
  product_id: string | null
  status: CheckoutStatus
  currency: string | null
  amount: number | string | null
  customer: Record<string, unknown> | null
  attribution: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  abandoned_at: string | null
  completed_at: string | null
  recovery_count: number | null
  recovery_status: string | null
  funnel_name: string | null
  product_name: string | null
  transaction_id: string | null
  payment_status: PaymentStatus | null
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
  amount: number | string
}

type PagePayload = {
  items?: CheckoutOperation[]
  metrics?: Partial<CheckoutMetrics>
  has_more?: boolean
  next_cursor?: { created_at?: string; id?: string } | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
}

function money(amount: number | string | null, currency: string | null): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount ?? 0)
  if (!Number.isFinite(numeric)) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(numeric)
  } catch {
    return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric)} ${currency || 'BRL'}`
  }
}

function checkoutLabel(status: string): string {
  const labels: Record<string, string> = { started: 'Iniciado', pending: 'Pendente', processing: 'Processando', completed: 'Concluído', abandoned: 'Abandonado', failed: 'Falhou' }
  return labels[status.toLowerCase()] || status
}

function checkoutClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed': return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    case 'failed': return 'border-rose-400/20 bg-rose-400/10 text-rose-300'
    case 'abandoned': return 'border-amber-400/20 bg-amber-400/10 text-amber-300'
    case 'processing': return 'border-sky-400/20 bg-sky-400/10 text-sky-300'
    default: return 'border-white/10 bg-white/[0.04] text-zinc-300'
  }
}

function paymentLabel(status: string | null): string {
  if (!status) return 'Sem tentativa'
  const labels: Record<string, string> = {
    created: 'Criado',
    pending: 'Pendente',
    approved: 'Aprovado',
    failed: 'Falhou',
    refunded: 'Reembolsado',
    chargeback: 'Chargeback',
  }
  return labels[status.toLowerCase()] || status
}

function paymentClass(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'approved': return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    case 'failed': return 'border-rose-400/20 bg-rose-400/10 text-rose-300'
    case 'refunded': return 'border-sky-400/20 bg-sky-400/10 text-sky-300'
    case 'chargeback': return 'border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-300'
    case 'pending':
    case 'created': return 'border-amber-400/20 bg-amber-400/10 text-amber-300'
    default: return 'border-white/10 bg-white/[0.04] text-zinc-400'
  }
}

function customerName(customer: Record<string, unknown> | null): string {
  const data = record(customer)
  return text(data.name ?? data.full_name ?? data.nome ?? data.email) || 'Cliente não identificado'
}

export default function CheckoutsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [sessions, setSessions] = useState<CheckoutOperation[]>([])
  const [serverMetrics, setServerMetrics] = useState<CheckoutMetrics>({ total: 0, active: 0, completed: 0, abandoned: 0, failed: 0, amount: 0 })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')

    const collected: CheckoutOperation[] = []
    let cursor: { created_at?: string; id?: string } | null = null
    let firstMetrics: Partial<CheckoutMetrics> | null = null

    for (let page = 0; page < 2; page += 1) {
      const { data, error: rpcError } = await supabase.rpc('checkout_operations_page_v1', {
        p_limit: 100,
        p_cursor_created_at: cursor?.created_at || null,
        p_cursor_id: cursor?.id || null,
        p_status: null,
        p_query: null,
        p_funnel_id: null,
      })

      if (rpcError) throw rpcError
      const payload = record(data) as PagePayload
      if (!firstMetrics) firstMetrics = record(payload.metrics) as Partial<CheckoutMetrics>
      if (Array.isArray(payload.items)) collected.push(...payload.items)
      if (!payload.has_more || !payload.next_cursor?.created_at || !payload.next_cursor?.id) break
      cursor = payload.next_cursor
    }

    setSessions(collected)
    setServerMetrics({
      total: Number(firstMetrics?.total ?? 0),
      active: Number(firstMetrics?.active ?? 0),
      completed: Number(firstMetrics?.completed ?? 0),
      abandoned: Number(firstMetrics?.abandoned ?? 0),
      failed: Number(firstMetrics?.failed ?? 0),
      amount: firstMetrics?.amount ?? 0,
    })
  }, [supabase])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try { await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os checkouts.') }
    finally { setRefreshing(false); setLoading(false) }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    let active = true
    const channel = supabase.channel('dashboard-checkout-operations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions' }, () => { if (active) void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions' }, () => { if (active) void load() })
      .subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [load, supabase])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return sessions.filter((item) => {
      if (status !== 'all' && item.status.toLowerCase() !== status) return false
      if (!normalized) return true
      const customer = record(item.customer)
      const attribution = record(item.attribution)
      const haystack = [
        item.id,
        item.transaction_id,
        item.provider_external_id,
        customerName(customer),
        text(customer.email),
        item.funnel_name,
        item.product_name,
        item.gateway_name,
        item.gateway_provider,
        item.payment_status,
        text(attribution.source),
        text(attribution.campaign),
      ].join(' ').toLowerCase()
      return haystack.includes(normalized)
    })
  }, [query, sessions, status])

  const lifecycleDrift = useMemo(() => sessions.filter((item) => {
    const payment = item.payment_status?.toLowerCase()
    const checkout = item.status.toLowerCase()
    return (payment === 'approved' && checkout !== 'completed')
      || (payment === 'failed' && !['failed', 'abandoned'].includes(checkout))
  }).length, [sessions])

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-[0.22em] text-[var(--althea-brand)]">OPERAÇÃO / VENDAS</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Checkouts</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--althea-muted)]">Sessões de checkout reconciliadas com a transação de pagamento mais recente da operação.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white transition hover:bg-white/[0.06] disabled:opacity-50">
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Atualizar
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {lifecycleDrift > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-300" />
          <div><strong>{lifecycleDrift} checkout(s) com divergência de lifecycle.</strong><p className="mt-1 text-xs text-amber-100/65">O status financeiro abaixo vem da transação real e permanece separado do status da sessão para não ocultar inconsistências do backend.</p></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric icon={ShoppingCart} label="Sessões" value={serverMetrics.total} />
        <Metric icon={Clock3} label="Em andamento" value={serverMetrics.active} />
        <Metric icon={CheckCircle2} label="Concluídos" value={serverMetrics.completed} />
        <Metric icon={XCircle} label="Abandonados" value={serverMetrics.abandoned} />
        <Metric icon={XCircle} label="Falhos" value={serverMetrics.failed} />
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/10 px-3">
            <Search size={17} className="shrink-0 text-[var(--althea-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, funil, produto, gateway ou transação..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--althea-muted)]" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status do checkout" className="h-11 rounded-xl border border-white/[0.07] bg-[#111513] px-3 text-sm text-white outline-none">
            <option value="all">Todos os checkouts</option><option value="started">Iniciados</option><option value="pending">Pendentes</option><option value="processing">Processando</option><option value="completed">Concluídos</option><option value="abandoned">Abandonados</option><option value="failed">Falhos</option>
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? <div className="space-y-3 py-4">{[1,2,3,4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />)}</div> : filtered.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] px-6 text-center">
              <CreditCard size={25} className="mb-3 text-[var(--althea-muted)]" />
              <p className="text-sm font-medium text-white">Nenhuma sessão encontrada</p>
              <p className="mt-1 max-w-md text-xs text-[var(--althea-muted)]">Quando checkouts reais forem registrados, eles aparecerão aqui automaticamente.</p>
            </div>
          ) : (
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead><tr className="border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--althea-muted)]"><th className="px-3 py-3">Cliente</th><th className="px-3 py-3">Funil</th><th className="px-3 py-3">Produto</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3">Checkout</th><th className="px-3 py-3">Pagamento</th><th className="px-3 py-3">Gateway</th><th className="px-3 py-3">Criado</th></tr></thead>
              <tbody>{filtered.map((item) => <tr key={item.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"><td className="px-3 py-4"><p className="font-medium text-white">{customerName(item.customer)}</p><p className="mt-0.5 max-w-[220px] truncate text-xs text-[var(--althea-muted)]">{text(record(item.customer).email) || item.id.slice(0, 12)}</p></td><td className="px-3 py-4 text-zinc-300">{item.funnel_name || item.funnel_id || '—'}</td><td className="px-3 py-4 text-zinc-300">{item.product_name || item.product_id || '—'}</td><td className="px-3 py-4 font-medium text-white">{money(item.amount, item.currency)}</td><td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${checkoutClass(item.status)}`}>{checkoutLabel(item.status)}</span></td><td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${paymentClass(item.payment_status)}`}>{paymentLabel(item.payment_status)}</span>{(item.payment_error || item.failure_code) && <p className="mt-1 max-w-[190px] truncate text-[10px] text-rose-300/70" title={item.payment_error || item.failure_code || undefined}>{item.payment_error || item.failure_code}</p>}</td><td className="px-3 py-4"><p className="text-zinc-300">{item.gateway_name || item.gateway_provider || item.gateway_id || '—'}</p>{item.provider_external_id && <p className="mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-[var(--althea-muted)]">{item.provider_external_id}</p>}</td><td className="px-3 py-4 text-xs text-[var(--althea-muted)]">{new Date(item.created_at).toLocaleString('pt-BR')}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        {sessions.length >= 200 && <p className="mt-3 text-right text-[10px] text-[var(--althea-muted)]">Exibindo as 200 sessões mais recentes. A busca desta tela atua sobre este recorte operacional.</p>}
      </div>
    </section>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShoppingCart; label: string; value: number }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-[var(--althea-surface)] p-4"><div className="flex items-center gap-2 text-xs text-[var(--althea-muted)]"><Icon size={15} />{label}</div><p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p></div>
}
