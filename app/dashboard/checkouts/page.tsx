'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { CheckCircle2, Clock3, CreditCard, RefreshCw, Search, ShoppingCart, XCircle } from 'lucide-react'

type CheckoutStatus = 'pending' | 'completed' | 'abandoned' | 'failed' | string

type CheckoutSession = {
  id: string
  funnel_id: string | null
  product_id: string | null
  status: CheckoutStatus
  currency: string | null
  amount: number | string | null
  customer: Record<string, unknown> | null
  attribution: Record<string, unknown> | null
  created_at: string
  updated_at: string
  abandoned_at: string | null
  completed_at: string | null
  recovery_count: number | null
  recovery_status: string | null
}

type Funnel = { id: string; nome: string }
type Product = { id: string; data: Record<string, unknown> | null }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
}

function money(amount: number | string | null, currency: string | null): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount ?? 0)
  if (!Number.isFinite(numeric)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(numeric)
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { pending: 'Pendente', completed: 'Concluído', abandoned: 'Abandonado', failed: 'Falhou' }
  return labels[status.toLowerCase()] || status
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed': return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    case 'failed': return 'border-rose-400/20 bg-rose-400/10 text-rose-300'
    case 'abandoned': return 'border-amber-400/20 bg-amber-400/10 text-amber-300'
    default: return 'border-white/10 bg-white/[0.04] text-zinc-300'
  }
}

function customerName(customer: Record<string, unknown> | null): string {
  const data = record(customer)
  return text(data.name ?? data.full_name ?? data.nome ?? data.email) || 'Cliente não identificado'
}

function productName(product: Product | undefined, productId: string | null): string {
  if (!product) return productId ? `Produto ${productId.slice(0, 8)}` : 'Produto não informado'
  const data = record(product.data)
  return text(data.name ?? data.nome ?? data.title ?? data.product_name) || `Produto ${product.id.slice(0, 8)}`
}

export default function CheckoutsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [sessions, setSessions] = useState<CheckoutSession[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) throw new Error('Sessão expirada. Faça login novamente.')

    const [{ data: checkoutData, error: checkoutError }, { data: funnelData, error: funnelError }, { data: productData, error: productError }] = await Promise.all([
      supabase.from('checkout_sessions')
        .select('id,funnel_id,product_id,status,currency,amount,customer,attribution,created_at,updated_at,abandoned_at,completed_at,recovery_count,recovery_status')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('funnels').select('id,nome').eq('user_id', auth.user.id).is('deleted_at', null),
      supabase.from('products').select('id,data').eq('user_id', auth.user.id).limit(200),
    ])

    if (checkoutError) throw checkoutError
    if (funnelError) throw funnelError
    if (productError) throw productError

    setSessions((checkoutData ?? []) as CheckoutSession[])
    setFunnels((funnelData ?? []) as Funnel[])
    setProducts((productData ?? []) as Product[])
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
    const channel = supabase.channel('dashboard-checkout-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions' }, () => { if (active) void load() })
      .subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [load, supabase])

  const funnelMap = useMemo(() => new Map(funnels.map((item) => [item.id, item.nome])), [funnels])
  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item])), [products])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return sessions.filter((item) => {
      if (status !== 'all' && item.status.toLowerCase() !== status) return false
      if (!normalized) return true
      const haystack = [item.id, customerName(item.customer), text(item.customer?.email), funnelMap.get(item.funnel_id || ''), productName(productMap.get(item.product_id || ''), item.product_id), text(item.attribution?.source), text(item.attribution?.campaign)].join(' ').toLowerCase()
      return haystack.includes(normalized)
    })
  }, [funnelMap, productMap, query, sessions, status])

  const metrics = useMemo(() => ({
    total: sessions.length,
    pending: sessions.filter((item) => item.status.toLowerCase() === 'pending').length,
    completed: sessions.filter((item) => item.status.toLowerCase() === 'completed').length,
    abandoned: sessions.filter((item) => item.status.toLowerCase() === 'abandoned').length,
  }), [sessions])

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-[0.22em] text-[var(--althea-brand)]">OPERAÇÃO / VENDAS</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Checkouts</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--althea-muted)]">Sessões reais de checkout recebidas pelo ALTHEA PAY. Nenhum valor é inventado quando não há dados.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white transition hover:bg-white/[0.06] disabled:opacity-50">
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Atualizar
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={ShoppingCart} label="Sessões" value={metrics.total} />
        <Metric icon={Clock3} label="Pendentes" value={metrics.pending} />
        <Metric icon={CheckCircle2} label="Concluídos" value={metrics.completed} />
        <Metric icon={XCircle} label="Abandonados" value={metrics.abandoned} />
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.07] bg-black/10 px-3">
            <Search size={17} className="shrink-0 text-[var(--althea-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, funil, produto ou campanha..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--althea-muted)]" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status" className="h-11 rounded-xl border border-white/[0.07] bg-[#111513] px-3 text-sm text-white outline-none">
            <option value="all">Todos os status</option><option value="pending">Pendentes</option><option value="completed">Concluídos</option><option value="abandoned">Abandonados</option><option value="failed">Falhos</option>
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
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead><tr className="border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--althea-muted)]"><th className="px-3 py-3">Cliente</th><th className="px-3 py-3">Funil</th><th className="px-3 py-3">Produto</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Criado</th></tr></thead>
              <tbody>{filtered.map((item) => <tr key={item.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"><td className="px-3 py-4"><p className="font-medium text-white">{customerName(item.customer)}</p><p className="mt-0.5 text-xs text-[var(--althea-muted)]">{text(item.customer?.email) || item.id.slice(0, 12)}</p></td><td className="px-3 py-4 text-zinc-300">{funnelMap.get(item.funnel_id || '') || '—'}</td><td className="px-3 py-4 text-zinc-300">{productName(productMap.get(item.product_id || ''), item.product_id)}</td><td className="px-3 py-4 font-medium text-white">{money(item.amount, item.currency)}</td><td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></td><td className="px-3 py-4 text-xs text-[var(--althea-muted)]">{new Date(item.created_at).toLocaleString('pt-BR')}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShoppingCart; label: string; value: number }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-[var(--althea-surface)] p-4"><div className="flex items-center gap-2 text-xs text-[var(--althea-muted)]"><Icon size={15} />{label}</div><p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p></div>
}
