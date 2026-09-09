'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CheckCircle2, Clock3, Copy, CreditCard, Loader2, RefreshCw, Search, TriangleAlert, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type JsonRecord = Record<string, unknown>

type GatewayTransaction = {
  id: string
  user_id: string
  funnel_id: string | null
  product_id: string | null
  gateway_id: string | null
  external_id: string | null
  idempotency_key: string | null
  amount: number
  currency: string
  status: string
  customer: JsonRecord
  metadata: JsonRecord
  error_message: string | null
  created_at: string
  updated_at: string
  attempt_count: number
  completed_at: string | null
  failure_code: string | null
  routing_metadata: JsonRecord
  version: number
}

const PAGE_SIZE = 100
const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'approved', label: 'Aprovados' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'failed', label: 'Falhas' },
  { value: 'refunded', label: 'Estornados' },
  { value: 'chargeback', label: 'Chargeback' },
] as const

const APPROVED = new Set(['approved', 'completed', 'paid', 'success', 'succeeded'])

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function nestedCustomer(tx: GatewayTransaction): JsonRecord {
  const metadataCustomer = asRecord(tx.metadata.customer)
  return Object.keys(metadataCustomer).length ? metadataCustomer : asRecord(tx.customer)
}

function textValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(Number(amount) || 0)
}

function statusMeta(status: string) {
  const normalized = status.toLowerCase()
  if (APPROVED.has(normalized)) return { label: 'APROVADA', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400', Icon: CheckCircle2 }
  if (normalized === 'pending' || normalized === 'created') return { label: normalized === 'created' ? 'CRIADA' : 'PENDENTE', className: 'border-amber-500/20 bg-amber-500/10 text-amber-400', Icon: Clock3 }
  if (normalized === 'refunded') return { label: 'ESTORNADA', className: 'border-sky-500/20 bg-sky-500/10 text-sky-400', Icon: RefreshCw }
  if (normalized === 'chargeback') return { label: 'CHARGEBACK', className: 'border-orange-500/20 bg-orange-500/10 text-orange-400', Icon: TriangleAlert }
  return { label: normalized ? normalized.toUpperCase() : 'FALHA', className: 'border-rose-500/20 bg-rose-500/10 text-rose-400', Icon: XCircle }
}

export default function SalesAuditPage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [transactions, setTransactions] = useState<GatewayTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [copiedId, setCopiedId] = useState('')

  const loadSalesLedger = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) {
      router.replace('/login')
      return
    }

    const { data, error: queryError } = await supabase
      .from('gateway_transactions')
      .select('id,user_id,funnel_id,product_id,gateway_id,external_id,idempotency_key,amount,currency,status,customer,metadata,error_message,created_at,updated_at,attempt_count,completed_at,failure_code,routing_metadata,version')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (queryError) throw queryError
    setTransactions((data ?? []) as GatewayTransaction[])
  }, [router, supabase])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      await loadSalesLedger()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar o ledger de vendas.')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [loadSalesLedger])

  useEffect(() => {
    let active = true
    void refresh()

    const channel = supabase
      .channel('sales-audit-gateway-transactions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions' }, (payload) => {
        if (!active) return
        const next = payload.new as Partial<GatewayTransaction>
        const previous = payload.old as Partial<GatewayTransaction>
        setTransactions((current) => {
          if (payload.eventType === 'INSERT') {
            if (!next.id || !next.user_id) return current
            return next.user_id === current[0]?.user_id && !current.some((tx) => tx.id === next.id) ? [next as GatewayTransaction, ...current].slice(0, PAGE_SIZE) : next.user_id ? [next as GatewayTransaction, ...current.filter((tx) => tx.id !== next.id)].slice(0, PAGE_SIZE) : current
          }
          if (payload.eventType === 'UPDATE') {
            if (!next.id) return current
            if (next.user_id && current.length && next.user_id !== current[0]?.user_id) return current
            return current.map((tx) => tx.id === next.id ? next as GatewayTransaction : tx)
          }
          if (payload.eventType === 'DELETE') return previous.id ? current.filter((tx) => tx.id !== previous.id) : current
          return current
        })
      })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [refresh, supabase])

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return transactions.filter((tx) => {
      if (statusFilter !== 'all' && tx.status.toLowerCase() !== statusFilter) return false
      if (!query) return true

      const customer = nestedCustomer(tx)
      const searchable = [
        tx.id,
        tx.external_id,
        tx.gateway_id,
        tx.funnel_id,
        tx.product_id,
        textValue(customer.name),
        textValue(customer.email),
        textValue(customer.phone),
        JSON.stringify(tx.metadata),
      ].filter(Boolean).join(' ').toLowerCase()

      return searchable.includes(query)
    })
  }, [searchQuery, statusFilter, transactions])

  const totals = useMemo(() => {
    const approved = transactions.filter((tx) => APPROVED.has(tx.status.toLowerCase()))
    return { count: approved.length, volume: approved.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0) }
  }, [transactions])

  async function copyTransactionId(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(''), 1400)
    } catch { setCopiedId('') }
  }

  return (
    <div className="min-h-screen bg-[#060608] text-zinc-100 antialiased font-sans">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[#191921] bg-[#0b0b0f]/95 px-4 backdrop-blur sm:px-6">
        <button type="button" onClick={() => router.push('/dashboard/settings')} className="min-h-11 px-1 text-xs font-mono text-zinc-400 transition hover:text-white">← VOLTAR</button>
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500"><CreditCard size={13} className="text-[#1DB854]" /> Auditoria de Vendas</div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-4 p-4 pb-32 sm:p-6 sm:pb-32">
        <section className="rounded-2xl border border-[#191921] bg-[#0b0b0f] p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div><h1 className="text-lg font-bold tracking-tight text-white">Vendas</h1><p className="mt-1 text-[11px] text-zinc-500">Ledger transacional da operação, atualizado em tempo real.</p></div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <div className="rounded-lg border border-[#191921] bg-[#060608] px-3 py-2"><span className="block text-[9px] font-mono uppercase text-zinc-600">Aprovadas</span><strong className="text-sm text-white">{totals.count}</strong></div>
              <div className="rounded-lg border border-[#191921] bg-[#060608] px-3 py-2"><span className="block text-[9px] font-mono uppercase text-zinc-600">Volume carregado</span><strong className="text-sm text-white">{money(totals.volume, 'BRL')}</strong></div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-3 text-zinc-600" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ID, e-mail, nome, telefone, gateway ou metadata..." className="h-11 w-full rounded-lg border border-[#191921] bg-[#060608] pl-9 pr-3 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-zinc-600" aria-label="Pesquisar vendas" />
            </div>
            <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {STATUS_FILTERS.map((filter) => <button key={filter.value} type="button" onClick={() => setStatusFilter(filter.value)} className={`min-h-11 whitespace-nowrap rounded-lg border px-3 text-[11px] font-medium transition ${statusFilter === filter.value ? 'border-white bg-white text-black' : 'border-[#191921] bg-[#060608] text-zinc-500 hover:text-white'}`}>{filter.label}</button>)}
            </div>
            <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#191921] bg-[#060608] px-3 text-[10px] font-mono text-zinc-400 transition hover:text-white disabled:opacity-50">{refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} ATUALIZAR</button>
          </div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-300">{error}</div>}

        <section className="sm:hidden space-y-3">
          {loading ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-[#191921] bg-[#0b0b0f]" />) : filteredTransactions.length === 0 ? <EmptyState /> : filteredTransactions.map((tx) => <MobileTransaction key={tx.id} tx={tx} onCopy={copyTransactionId} copied={copiedId === tx.id} />)}
        </section>

        <section className="hidden overflow-hidden rounded-2xl border border-[#191921] bg-[#0b0b0f] sm:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead><tr className="border-b border-[#191921] bg-[#08080b] text-[9px] font-mono uppercase tracking-wider text-zinc-600"><th className="px-4 py-3 font-normal">Transação</th><th className="px-4 py-3 font-normal">Comprador</th><th className="px-4 py-3 font-normal">Volume</th><th className="px-4 py-3 font-normal">Gateway</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3 font-normal">Data</th></tr></thead>
              <tbody>
                {loading ? Array.from({ length: 6 }).map((_, index) => <tr key={index} className="border-b border-[#191921]/60"><td colSpan={6} className="px-4 py-5"><div className="h-4 animate-pulse rounded bg-zinc-900" /></td></tr>) : filteredTransactions.length === 0 ? <tr><td colSpan={6}><EmptyState /></td></tr> : filteredTransactions.map((tx) => <DesktopTransaction key={tx.id} tx={tx} onCopy={copyTransactionId} copied={copiedId === tx.id} />)}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

function DesktopTransaction({ tx, onCopy, copied }: { tx: GatewayTransaction; onCopy: (id: string) => void; copied: boolean }) {
  const customer = nestedCustomer(tx)
  const meta = statusMeta(tx.status)
  const Icon = meta.Icon
  return <tr className="border-b border-[#191921]/60 transition hover:bg-white/[0.015] last:border-0">
    <td className="px-4 py-3"><div className="flex items-center gap-2"><div><p className="max-w-[210px] truncate font-mono text-[11px] text-zinc-300">{tx.id}</p><p className="mt-1 max-w-[210px] truncate text-[9px] text-zinc-600">ext: {tx.external_id || '—'}</p></div><button type="button" onClick={() => void onCopy(tx.id)} aria-label="Copiar ID" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-600 transition hover:bg-white/5 hover:text-white">{copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}</button></div></td>
    <td className="px-4 py-3"><p className="max-w-[190px] truncate text-xs text-zinc-200">{textValue(customer.name) || 'Cliente não identificado'}</p><p className="mt-1 max-w-[190px] truncate text-[10px] text-zinc-600">{textValue(customer.email) || textValue(customer.phone) || 'Contato não informado'}</p></td>
    <td className="px-4 py-3"><span className="font-mono text-xs font-semibold text-white">{money(tx.amount, tx.currency)}</span></td>
    <td className="px-4 py-3"><span className="font-mono text-[10px] text-zinc-400">{tx.gateway_id || '—'}</span></td>
    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-bold ${meta.className}`}><Icon size={11} />{meta.label}</span></td>
    <td className="px-4 py-3"><span className="text-[10px] text-zinc-500">{new Date(tx.created_at).toLocaleString('pt-BR')}</span></td>
  </tr>
}

function MobileTransaction({ tx, onCopy, copied }: { tx: GatewayTransaction; onCopy: (id: string) => void; copied: boolean }) {
  const customer = nestedCustomer(tx)
  const meta = statusMeta(tx.status)
  const Icon = meta.Icon
  return <article className="rounded-xl border border-[#191921] bg-[#0b0b0f] p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-mono text-[11px] text-zinc-300">{tx.id}</p><p className="mt-1 truncate text-[10px] text-zinc-600">{textValue(customer.email) || textValue(customer.phone) || 'Contato não informado'}</p></div><span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold ${meta.className}`}><Icon size={10} />{meta.label}</span></div>
    <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-wider text-zinc-600">Comprador</p><p className="mt-1 text-xs font-medium text-zinc-200">{textValue(customer.name) || 'Cliente não identificado'}</p></div><p className="font-mono text-sm font-bold text-white">{money(tx.amount, tx.currency)}</p></div>
    <div className="mt-4 flex items-center justify-between border-t border-[#191921] pt-3"><span className="text-[9px] font-mono text-zinc-600">{tx.gateway_id || 'gateway —'} · {new Date(tx.created_at).toLocaleString('pt-BR')}</span><button type="button" onClick={() => void onCopy(tx.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[9px] font-mono text-zinc-500 hover:bg-white/5 hover:text-white">{copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}{copied ? 'COPIADO' : 'ID'}</button></div>
  </article>
}

function EmptyState() {
  return <div className="flex min-h-32 flex-col items-center justify-center gap-2 p-6 text-center"><ArrowUpRight size={18} className="text-zinc-700" /><p className="text-xs text-zinc-500">Nenhum registro operacional localizado.</p><p className="text-[10px] text-zinc-700">Ajuste a busca ou o filtro de status.</p></div>
}
