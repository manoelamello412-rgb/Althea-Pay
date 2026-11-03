'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { CheckCircle2, Clock3, CreditCard, Mail, MessageCircle, RefreshCw, Search, ShoppingCart, XCircle } from 'lucide-react'
import { CheckoutDetail } from './checkout-detail'
import { periodRange, type Period } from '@/lib/checkout-period'

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
  const labels: Record<string, string> = { started: 'Iniciado', pending: 'Pendente', processing: 'Em processamento', completed: 'Pago', abandoned: 'Abandonado', failed: 'Falhou' }
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
    created: 'Em processamento',
    processing: 'Em processamento',
    pending: 'Pendente',
    approved: 'Aprovado/Pago',
    failed: 'Falhou',
    refunded: 'Estornado',
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
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [funnelId, setFunnelId] = useState('')
  const [funnels, setFunnels] = useState<{ id: string; nome: string }[]>([])
  const [period, setPeriod] = useState<Period>('all')
  const [periodA, setPeriodA] = useState('')
  const [periodB, setPeriodB] = useState('')
  const [selected, setSelected] = useState<CheckoutOperation | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')

    const collected: CheckoutOperation[] = []
    let cursor: { created_at?: string; id?: string } | null = null
    let firstMetrics: Partial<CheckoutMetrics> | null = null

    const [from, to] = periodRange(period, periodA, periodB)
    for (let page = 0; page < 2; page += 1) {
      const { data, error: rpcError } = await supabase.rpc('checkout_operations_page_v1', {
        p_limit: 100,
        p_cursor_created_at: cursor?.created_at || null,
        p_cursor_id: cursor?.id || null,
        p_status: status === 'all' ? null : status,
        p_query: search || null,
        p_funnel_id: funnelId || null,
        p_from: from,
        p_to: to,
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
  }, [supabase, status, search, funnelId, period, periodA, periodB])

  useEffect(() => { const id = setTimeout(() => setSearch(query.trim()), 350); return () => clearTimeout(id) }, [query])
  useEffect(() => {
    void supabase.from('funnels').select('id,nome').is('deleted_at', null).order('nome')
      .then(({ data }: { data: { id: string; nome: string }[] | null }) => setFunnels(data ?? []))
  }, [supabase])

  const remarketing = useCallback(async (item: CheckoutOperation, channel: 'email' | 'whatsapp') => {
    setNotice(''); setError('')
    const { error: rpcError } = await supabase.rpc('checkout_remarketing_send_v1', { p_checkout_id: item.id, p_channel: channel })
    if (!rpcError) { setNotice(`Remarketing por ${channel === 'email' ? 'e-mail' : 'WhatsApp'} enfileirado para ${customerName(item.customer)}.`); return }
    const code = rpcError.message || ''
    setError(code.includes('RECENTLY_SENT') ? 'Já foi enviado por este canal nos últimos 10 minutos.'
      : code.includes('ALREADY_PAID') ? 'Este checkout já foi pago.'
      : code.includes('CHANNEL_ACCOUNT_MISSING') ? `Nenhuma conta de ${channel === 'email' ? 'e-mail' : 'WhatsApp'} ativa. Configure em CRM > Configurações.`
      : code.includes('FORBIDDEN') ? 'Sem permissão para enviar mensagens.' : 'Não foi possível enfileirar o remarketing.')
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

  const filtered = sessions

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

      {notice && <div role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric icon={ShoppingCart} label="Sessões" value={serverMetrics.total} />
        <Metric icon={Clock3} label="Em andamento" value={serverMetrics.active} />
        <Metric icon={CheckCircle2} label="Pagos" value={serverMetrics.completed} />
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
            <option value="all">Todos os status</option><option value="started">Iniciados</option><option value="pending">Pendentes</option><option value="processing">Em processamento</option><option value="completed">Pagos</option><option value="abandoned">Abandonados</option><option value="failed">Falhos</option>
          </select>
          <select value={funnelId} onChange={(event) => setFunnelId(event.target.value)} aria-label="Filtrar por funil" className="h-11 rounded-xl border border-white/[0.07] bg-[#111513] px-3 text-sm text-white outline-none">
            <option value="">Todos os funis</option>{funnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.nome}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <select value={period} onChange={(event) => { setPeriod(event.target.value as Period); setPeriodA(''); setPeriodB('') }} aria-label="Período" className="h-10 rounded-xl border border-white/[0.07] bg-[#111513] px-3 text-white outline-none">
            <option value="all">Todo o período</option><option value="today">Hoje</option><option value="day">Um dia</option><option value="range">Período</option><option value="month">Mês</option><option value="year">Ano</option>
          </select>
          {period === 'day' && <input type="date" aria-label="Dia" value={periodA} onChange={(event) => setPeriodA(event.target.value)} className={dateInput} />}
          {period === 'range' && <><input type="date" aria-label="De" value={periodA} onChange={(event) => setPeriodA(event.target.value)} className={dateInput} /><span className="text-[var(--althea-muted)]">até</span><input type="date" aria-label="Até" value={periodB} min={periodA || undefined} onChange={(event) => setPeriodB(event.target.value)} className={dateInput} /></>}
          {period === 'month' && <input type="month" aria-label="Mês" value={periodA} onChange={(event) => setPeriodA(event.target.value)} className={dateInput} />}
          {period === 'year' && <input type="number" aria-label="Ano" placeholder="2026" min={2020} max={2100} value={periodA} onChange={(event) => setPeriodA(event.target.value)} className={`${dateInput} w-28`} />}
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
              <thead><tr className="border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--althea-muted)]"><th className="px-3 py-3">Cliente</th><th className="px-3 py-3">Funil</th><th className="px-3 py-3">Produto</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3">Checkout</th><th className="px-3 py-3">Pagamento</th><th className="px-3 py-3">Gateway</th><th className="px-3 py-3">Criado</th><th className="px-3 py-3"><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>{filtered.map((item) => <tr key={item.id} onClick={() => setSelected(item)} className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"><td className="px-3 py-4"><button type="button" onClick={(event) => { event.stopPropagation(); setSelected(item) }} className="text-left font-medium text-white hover:underline">{customerName(item.customer)}</button><p className="mt-0.5 max-w-[220px] truncate text-xs text-[var(--althea-muted)]">{text(record(item.customer).email) || item.id.slice(0, 12)}</p></td><td className="px-3 py-4 text-zinc-300">{item.funnel_name || item.funnel_id || '—'}</td><td className="px-3 py-4 text-zinc-300">{item.product_name || item.product_id || '—'}</td><td className="px-3 py-4 font-medium text-white">{money(item.amount, item.currency)}</td><td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${checkoutClass(item.status)}`}>{checkoutLabel(item.status)}</span></td><td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${paymentClass(item.payment_status)}`}>{paymentLabel(item.payment_status)}</span>{(item.payment_error || item.failure_code) && <p className="mt-1 max-w-[190px] truncate text-[10px] text-rose-300/70" title={item.payment_error || item.failure_code || undefined}>{item.payment_error || item.failure_code}</p>}</td><td className="px-3 py-4"><p className="text-zinc-300">{item.gateway_name || item.gateway_provider || item.gateway_id || '—'}</p>{item.provider_external_id && <p className="mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-[var(--althea-muted)]">{item.provider_external_id}</p>}</td><td className="px-3 py-4 text-xs text-[var(--althea-muted)]">{new Date(item.created_at).toLocaleString('pt-BR')}</td><td className="px-3 py-4">{canRemarket(item) && <div className="flex gap-1" onClick={(event) => event.stopPropagation()}><button type="button" title="Remarketing por e-mail" aria-label={`Remarketing por e-mail para ${customerName(item.customer)}`} onClick={() => void remarketing(item, 'email')} className={actionButton}><Mail size={14} /></button><button type="button" title="Remarketing por WhatsApp" aria-label={`Remarketing por WhatsApp para ${customerName(item.customer)}`} onClick={() => void remarketing(item, 'whatsapp')} className={actionButton}><MessageCircle size={14} /></button></div>}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        {sessions.length >= 200 && <p className="mt-3 text-right text-[10px] text-[var(--althea-muted)]">Exibindo as 200 sessões mais recentes do filtro. Refine o período para ver as anteriores.</p>}
      </div>
      {selected && <CheckoutDetail checkoutId={selected.id} transactionId={selected.transaction_id} onClose={() => setSelected(null)} onRemarketing={(channel) => void remarketing(selected, channel)} canRemarket={canRemarket(selected)} />}
    </section>
  )
}

const dateInput = 'h-10 rounded-xl border border-white/[0.07] bg-[#111513] px-3 text-white outline-none [color-scheme:dark]'
const actionButton = 'rounded-lg border border-white/10 p-1.5 text-zinc-300 hover:bg-white/[0.06] hover:text-white'

function canRemarket(item: CheckoutOperation) {
  const payment = item.payment_status?.toLowerCase()
  return !item.completed_at && payment !== 'approved' && ['started', 'pending', 'processing', 'abandoned', 'failed'].includes(item.status.toLowerCase())
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShoppingCart; label: string; value: number }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-[var(--althea-surface)] p-4"><div className="flex items-center gap-2 text-xs text-[var(--althea-muted)]"><Icon size={15} />{label}</div><p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p></div>
}
