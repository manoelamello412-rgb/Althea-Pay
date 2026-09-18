'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { CheckCircle2, Clock3, CreditCard, RefreshCw, Search, ShoppingCart, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

type CheckoutStatus = 'started' | 'pending' | 'processing' | 'completed' | 'abandoned' | 'failed' | string

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
type Product = { id: string; name: string | null }

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
  const labels: Record<string, string> = {
    started: 'Iniciado',
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluído',
    abandoned: 'Abandonado',
    failed: 'Falhou',
  }
  return labels[status.toLowerCase()] || status
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[#7bdc9b]'
    case 'failed':
      return 'border-red-400/15 bg-red-400/[.06] text-red-300'
    case 'abandoned':
      return 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.07)] text-[#D4AF37]'
    case 'processing':
      return 'border-sky-400/15 bg-sky-400/[.06] text-sky-300'
    default:
      return 'border-white/[.06] bg-white/[.025] text-[var(--althea-muted)]'
  }
}

function customerName(customer: Record<string, unknown> | null): string {
  const data = record(customer)
  return text(data.name ?? data.full_name ?? data.nome ?? data.email) || 'Cliente não identificado'
}

function productName(product: Product | undefined, productId: string | null): string {
  if (!product) return productId ? `Produto ${productId.slice(0, 8)}` : 'Produto não informado'
  return text(product.name) || `Produto ${product.id.slice(0, 8)}`
}

export default function CheckoutsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [sessions, setSessions] = useState<CheckoutSession[]>([])
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !sessionData.session) {
      router.replace('/login')
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('default_organization_id')
      .eq('id', sessionData.session.user.id)
      .single()

    if (profileError || !profile?.default_organization_id) {
      throw new Error('Organização ativa não encontrada para esta conta.')
    }

    const activeOrganizationId = String(profile.default_organization_id)
    setOrganizationId(activeOrganizationId)

    const [
      { data: checkoutData, error: checkoutError },
      { data: funnelData, error: funnelError },
      { data: productData, error: productError },
    ] = await Promise.all([
      supabase
        .from('checkout_sessions')
        .select('id,funnel_id,product_id,status,currency,amount,customer,attribution,created_at,updated_at,abandoned_at,completed_at,recovery_count,recovery_status')
        .eq('organization_id', activeOrganizationId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('funnels')
        .select('id,nome')
        .eq('organization_id', activeOrganizationId)
        .is('deleted_at', null),
      supabase
        .from('products')
        .select('id,name')
        .eq('organization_id', activeOrganizationId)
        .is('deleted_at', null)
        .limit(200),
    ])

    if (checkoutError) throw checkoutError
    if (funnelError) throw funnelError
    if (productError) throw productError

    setSessions((checkoutData ?? []) as CheckoutSession[])
    setFunnels((funnelData ?? []) as Funnel[])
    setProducts((productData ?? []) as Product[])
  }, [router, supabase])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os checkouts.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [load])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!organizationId) return
    let active = true
    const channel = supabase
      .channel(`dashboard-checkout-sessions-${organizationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'checkout_sessions',
        filter: `organization_id=eq.${organizationId}`,
      }, () => { if (active) void load() })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [load, organizationId, supabase])

  const funnelMap = useMemo(() => new Map(funnels.map((item) => [item.id, item.nome])), [funnels])
  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item])), [products])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return sessions.filter((item) => {
      if (status !== 'all' && item.status.toLowerCase() !== status) return false
      if (!normalized) return true

      const customer = record(item.customer)
      const attribution = record(item.attribution)
      const haystack = [
        item.id,
        customerName(customer),
        text(customer.email),
        funnelMap.get(item.funnel_id || ''),
        productName(productMap.get(item.product_id || ''), item.product_id),
        text(attribution.source),
        text(attribution.campaign),
      ].join(' ').toLowerCase()

      return haystack.includes(normalized)
    })
  }, [funnelMap, productMap, query, sessions, status])

  const metrics = useMemo(() => ({
    total: sessions.length,
    pending: sessions.filter((item) => ['started', 'pending', 'processing'].includes(item.status.toLowerCase())).length,
    completed: sessions.filter((item) => item.status.toLowerCase() === 'completed').length,
    abandoned: sessions.filter((item) => item.status.toLowerCase() === 'abandoned').length,
  }), [sessions])

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">Jornada de compra</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Checkouts</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--althea-muted)]">
            Acompanhe as sessões reais de checkout, seus produtos, funis, valores e estados de conclusão.
          </p>
        </div>

        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center gap-2 self-start rounded-xl border border-white/[.06] bg-[var(--althea-surface)] px-4 text-[10px] font-semibold text-[var(--althea-muted)] transition hover:text-white disabled:opacity-50 lg:self-auto">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ShoppingCart} label="Sessões" value={metrics.total} />
        <Metric icon={Clock3} label="Em andamento" value={metrics.pending} />
        <Metric icon={CheckCircle2} label="Concluídos" value={metrics.completed} />
        <Metric icon={XCircle} label="Abandonados" value={metrics.abandoned} warning={metrics.abandoned > 0} />
      </section>

      <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px]">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3">
            <Search size={14} className="shrink-0 text-[var(--althea-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cliente, funil, produto ou campanha..."
              className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#56645d]"
            />
          </label>

          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status" className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-[10px] text-white outline-none">
            <option value="all">Todos os status</option>
            <option value="started">Iniciados</option>
            <option value="pending">Pendentes</option>
            <option value="processing">Processando</option>
            <option value="completed">Concluídos</option>
            <option value="abandoned">Abandonados</option>
            <option value="failed">Falhos</option>
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="grid min-h-[240px] place-items-center rounded-xl border border-dashed border-white/[.06] bg-[var(--althea-bg)] px-6 text-center">
              <div className="max-w-md">
                <CreditCard size={24} className="mx-auto text-[var(--althea-brand)] opacity-60" />
                <p className="mt-3 text-sm font-medium text-white">Nenhuma sessão encontrada</p>
                <p className="mt-1 text-[10px] leading-4 text-[var(--althea-muted)]">Quando checkouts reais forem registrados, eles aparecerão aqui automaticamente.</p>
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[850px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/[.05] text-[9px] text-[var(--althea-muted)]">
                  <th className="pb-3 pr-4 font-medium">Cliente</th>
                  <th className="pb-3 pr-4 font-medium">Funil</th>
                  <th className="pb-3 pr-4 font-medium">Produto</th>
                  <th className="pb-3 pr-4 font-medium">Valor</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Criado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-white/[.035] last:border-0">
                    <td className="py-3.5 pr-4">
                      <p className="text-[10px] font-semibold text-white">{customerName(item.customer)}</p>
                      <p className="mt-1 max-w-[220px] truncate text-[8px] text-[var(--althea-muted)]">{text(record(item.customer).email) || item.id.slice(0, 12)}</p>
                    </td>
                    <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{funnelMap.get(item.funnel_id || '') || '—'}</td>
                    <td className="py-3.5 pr-4 text-[10px] text-[var(--althea-muted)]">{productName(productMap.get(item.product_id || ''), item.product_id)}</td>
                    <td className="py-3.5 pr-4 text-[10px] font-semibold text-white">{money(item.amount, item.currency)}</td>
                    <td className="py-3.5 pr-4"><span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-semibold ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></td>
                    <td className="py-3.5 text-[9px] text-[var(--althea-muted)]">{new Date(item.created_at).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  warning = false,
}: {
  icon: typeof ShoppingCart
  label: string
  value: number
  warning?: boolean
}) {
  return (
    <article className="min-h-[112px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] text-[var(--althea-muted)]">{label}</span>
        <Icon size={15} className={warning ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} />
      </div>
      <p className={`mt-4 text-[24px] font-semibold tracking-[-.035em] ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}</p>
    </article>
  )
}
