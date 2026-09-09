'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronRight, Clock3, Layers, RefreshCw, ShieldCheck, Smartphone, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type GatewayPaymentStatus = 'created' | 'pending' | 'approved' | 'refunded' | 'chargeback' | 'failed'

export interface GatewayCustomerMetadata {
  name?: string
  email?: string
  phone?: string
  ip?: string
  card_brand?: string
  fee?: number
  attempts?: number
}

export interface GatewayTransactionRow {
  id: string
  user_id: string
  funnel_id: string
  product_id: string | null
  gateway_id: string
  external_id: string | null
  amount: number
  currency: string
  status: GatewayPaymentStatus
  created_at: string
  customer: GatewayCustomerMetadata
  routing_metadata: {
    strategy?: string
    requested_card_brand?: string
    selected_score?: number
    fallback_used?: boolean
  }
}

interface GatewayTransactionGridProps {
  currentTenantId: string
  onSelectTransaction: (transaction: GatewayTransactionRow) => void
  filterStatus?: string
  searchQuery?: string
}

type GatewayMeta = {
  id: string
  display_name: string
  provider: string
  environment: 'sandbox' | 'production'
  status: string
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeStatus = (value: unknown): GatewayPaymentStatus => {
  const status = String(value ?? '').trim().toLowerCase()
  if (['paid', 'completed', 'success', 'succeeded', 'captured'].includes(status)) return 'approved'
  if (['processing', 'in_process'].includes(status)) return 'pending'
  if (['declined', 'rejected', 'canceled', 'cancelled'].includes(status)) return 'failed'
  if (['refunded', 'chargeback', 'failed', 'pending', 'created'].includes(status)) return status as GatewayPaymentStatus
  return 'pending'
}

const toCustomer = (value: unknown): GatewayCustomerMetadata => {
  if (!isRecord(value)) return {}
  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    email: typeof value.email === 'string' ? value.email : undefined,
    phone: typeof value.phone === 'string' ? value.phone : undefined,
    ip: typeof value.ip === 'string' ? value.ip : undefined,
    card_brand: typeof value.card_brand === 'string' ? value.card_brand : undefined,
    fee: typeof value.fee === 'number' ? value.fee : undefined,
    attempts: typeof value.attempts === 'number' ? value.attempts : undefined,
  }
}

const toRouting = (value: unknown): GatewayTransactionRow['routing_metadata'] => {
  if (!isRecord(value)) return {}
  return {
    strategy: typeof value.strategy === 'string' ? value.strategy : undefined,
    requested_card_brand: typeof value.requested_card_brand === 'string' ? value.requested_card_brand : undefined,
    selected_score: typeof value.selected_score === 'number' ? value.selected_score : undefined,
    fallback_used: typeof value.fallback_used === 'boolean' ? value.fallback_used : undefined,
  }
}

const normalizeTransaction = (value: unknown): GatewayTransactionRow | null => {
  if (!isRecord(value)) return null
  const id = String(value.id ?? '').trim()
  const userId = String(value.user_id ?? '').trim()
  const funnelId = String(value.funnel_id ?? '').trim()
  const gatewayId = String(value.gateway_id ?? '').trim()
  if (!id || !userId || !funnelId || !gatewayId) return null
  return {
    id,
    user_id: userId,
    funnel_id: funnelId,
    product_id: value.product_id == null ? null : String(value.product_id),
    gateway_id: gatewayId,
    external_id: value.external_id == null ? null : String(value.external_id),
    amount: Number(value.amount ?? 0),
    currency: String(value.currency ?? 'BRL').toUpperCase(),
    status: normalizeStatus(value.status),
    created_at: String(value.created_at ?? ''),
    customer: toCustomer(value.customer),
    routing_metadata: toRouting(value.routing_metadata),
  }
}

const formatMoney = (amount: number, currency: string): string => {
  const normalizedCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'BRL'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: normalizedCurrency }).format(amount / 100)
}

const formatDate = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

export function GatewayTransactionGrid({ currentTenantId, onSelectTransaction, filterStatus = 'ALL', searchQuery = '' }: GatewayTransactionGridProps) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [transactions, setTransactions] = useState<GatewayTransactionRow[]>([])
  const [gateways, setGateways] = useState<Map<string, GatewayMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [systemError, setSystemError] = useState<string | null>(null)

  const fetchData = useCallback(async (manual = false) => {
    if (!currentTenantId) return
    if (manual) setRefreshing(true)
    else setLoading(true)
    try {
      const [transactionResult, gatewayResult] = await Promise.all([
        db.from('gateway_transactions').select('id,user_id,funnel_id,product_id,gateway_id,external_id,amount,currency,status,created_at,customer,routing_metadata').eq('user_id', currentTenantId).order('created_at', { ascending: false }).limit(100),
        db.from('gateways').select('id,display_name,provider,environment,status').eq('user_id', currentTenantId),
      ])
      if (transactionResult.error) throw transactionResult.error
      if (gatewayResult.error) throw gatewayResult.error
      const normalized = (transactionResult.data ?? []).map(normalizeTransaction).filter((item): item is GatewayTransactionRow => item !== null)
      const gatewayMap = new Map<string, GatewayMeta>()
      for (const raw of gatewayResult.data ?? []) {
        if (!isRecord(raw)) continue
        const id = String(raw.id ?? '').trim()
        if (!id) continue
        gatewayMap.set(id, {
          id,
          display_name: String(raw.display_name ?? raw.provider ?? id),
          provider: String(raw.provider ?? 'unknown'),
          environment: String(raw.environment ?? '').toLowerCase() === 'sandbox' ? 'sandbox' : 'production',
          status: String(raw.status ?? 'unknown'),
        })
      }
      setTransactions(normalized)
      setGateways(gatewayMap)
      setSystemError(null)
    } catch (error) {
      setSystemError(error instanceof Error ? error.message : 'Falha na sincronização do ledger do Gateway.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [currentTenantId, db])

  useEffect(() => {
    void fetchData()
    if (!currentTenantId) return undefined
    const channel = db.channel(`althea-gateway-transactions-${currentTenantId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'gateway_transactions', filter: `user_id=eq.${currentTenantId}`,
    }, () => { void fetchData() }).subscribe((status) => setRealtimeConnected(status === 'SUBSCRIBED'))
    return () => { setRealtimeConnected(false); void db.removeChannel(channel) }
  }, [currentTenantId, db, fetchData])

  const processedTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return transactions.filter((transaction) => {
      const statusMatch = filterStatus === 'ALL' ||
        (filterStatus === 'APPROVED' && transaction.status === 'approved') ||
        (filterStatus === 'PENDING' && transaction.status === 'pending') ||
        (filterStatus === 'REFUNDED' && transaction.status === 'refunded') ||
        (filterStatus === 'CHARGEBACK' && transaction.status === 'chargeback') ||
        (filterStatus === 'FAILED' && transaction.status === 'failed')
      if (!statusMatch) return false
      if (!query) return true
      const gateway = gateways.get(transaction.gateway_id)
      return [transaction.id, transaction.external_id ?? '', transaction.customer.name ?? '', transaction.customer.email ?? '', transaction.gateway_id, gateway?.display_name ?? '', gateway?.provider ?? '', transaction.product_id ?? ''].join(' ').toLowerCase().includes(query)
    })
  }, [filterStatus, gateways, searchQuery, transactions])

  return (
    <section className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-[#09090b] shadow-2xl shadow-black/20 backdrop-blur-md pb-32 md:pb-0">
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-neutral-800/80 bg-neutral-900/40 px-4 py-2 text-[10px] font-mono tracking-tight text-neutral-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />REALTIME: {realtimeConnected ? 'ACTIVE' : 'DISCONNECTED'}</span>
          <span className="hidden text-neutral-700 sm:inline">|</span>
          <span className="hidden sm:inline">LEDGER: {processedTransactions.length} RESULTADOS</span>
        </div>
        <button type="button" onClick={() => void fetchData(true)} disabled={refreshing} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 text-neutral-400 transition hover:border-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Atualizar transações">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Atualizar</span>
        </button>
      </header>
      {systemError && <div className="m-4 flex items-start gap-3 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-xs text-rose-300" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{systemError}</span></div>}
      <div className="hidden grid-cols-12 gap-4 border-b border-neutral-800 bg-neutral-900/10 px-6 py-3 text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500 md:grid"><div className="col-span-3">Identificador / Horário</div><div className="col-span-3">Cliente</div><div className="col-span-2">Gateway / Roteamento</div><div className="col-span-2 text-right">Liquidação</div><div className="col-span-2 text-center">Estado</div></div>
      <div className="max-h-[680px] divide-y divide-neutral-800/60 overflow-y-auto">
        {loading ? Array.from({ length: 6 }, (_, index) => <div key={index} className="grid grid-cols-12 gap-4 px-4 py-4 animate-pulse md:px-6"><div className="col-span-12 space-y-2 md:col-span-3"><div className="h-3.5 w-2/3 rounded bg-neutral-800/80" /><div className="h-2.5 w-1/2 rounded bg-neutral-800/50" /></div><div className="col-span-12 space-y-2 md:col-span-3"><div className="h-3 w-5/6 rounded bg-neutral-800/80" /><div className="h-2.5 w-2/3 rounded bg-neutral-800/50" /></div><div className="col-span-12 space-y-2 md:col-span-2"><div className="h-3 w-1/2 rounded bg-neutral-800/80" /><div className="h-2.5 w-3/4 rounded bg-neutral-800/50" /></div><div className="col-span-12 flex flex-col items-start gap-2 md:col-span-2 md:items-end"><div className="h-3.5 w-16 rounded bg-neutral-800/80" /><div className="h-2.5 w-10 rounded bg-neutral-800/50" /></div><div className="col-span-12 flex justify-start md:col-span-2 md:justify-center"><div className="h-5 w-20 rounded-full bg-neutral-800/80" /></div></div>)
        : processedTransactions.length === 0 ? <div className="flex flex-col items-center justify-center px-6 py-20 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-500"><Layers className="h-5 w-5" /></div><strong className="text-sm text-neutral-200">Zero eventos encontrados</strong><p className="mt-2 max-w-md text-xs leading-5 text-neutral-500">Nenhuma transação real foi encontrada no ledger do Gateway para os filtros e escopo deste tenant.</p></div>
        : processedTransactions.map((transaction) => {
          const gateway = gateways.get(transaction.gateway_id)
          const paid = transaction.status === 'approved'
          const statusClass = paid ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400' : transaction.status === 'refunded' ? 'border-blue-800/60 bg-blue-950/40 text-blue-400' : transaction.status === 'pending' ? 'border-neutral-800 bg-neutral-900 text-neutral-400' : transaction.status === 'chargeback' ? 'border-amber-800/60 bg-amber-950/40 text-amber-400' : 'border-rose-800/60 bg-rose-950/40 text-rose-400'
          return <button key={transaction.id} type="button" onClick={() => onSelectTransaction(transaction)} className="group relative grid w-full grid-cols-12 gap-3 px-4 py-3.5 text-left transition hover:bg-neutral-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 md:gap-4 md:px-6">
            <span className={`absolute inset-y-0 left-0 w-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${paid ? 'bg-emerald-500' : transaction.status === 'refunded' ? 'bg-blue-500' : 'bg-neutral-500'}`} />
            <span className="col-span-12 flex min-w-0 items-center gap-3 md:col-span-3"><span className={`hidden h-7 w-7 shrink-0 items-center justify-center rounded-md border md:flex ${paid ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-400' : 'border-neutral-800 bg-neutral-900 text-neutral-500'}`}>{paid ? <ArrowUpRight className="h-3.5 w-3.5" /> : transaction.status === 'refunded' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}</span><span className="min-w-0"><span className="block truncate font-mono text-[11px] text-neutral-200">TX_{transaction.id.slice(0, 12)}</span><span className="block text-[10px] text-neutral-500">{formatDate(transaction.created_at)}</span></span></span>
            <span className="col-span-12 min-w-0 md:col-span-3"><span className="block truncate text-xs font-medium text-neutral-200">{transaction.customer.name ?? 'Comprador não identificado'}</span><span className="block truncate text-[10px] text-neutral-500">{transaction.customer.email ?? '—'}</span>{transaction.customer.phone && <span className="block truncate text-[10px] text-neutral-600">{transaction.customer.phone}</span>}</span>
            <span className="col-span-12 min-w-0 md:col-span-2"><span className="flex items-center gap-1.5 truncate text-xs text-neutral-300"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-neutral-500" />{gateway?.display_name ?? transaction.gateway_id}</span><span className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-neutral-600"><Zap className="h-3 w-3" />{transaction.routing_metadata.strategy ?? gateway?.provider ?? 'route'}{transaction.routing_metadata.fallback_used ? ' · FALLBACK' : ''}</span></span>
            <span className="col-span-6 flex flex-col items-start md:col-span-2 md:items-end"><span className="text-sm font-semibold tabular-nums text-neutral-100">{formatMoney(transaction.amount, transaction.currency)}</span><span className="text-[10px] font-mono text-neutral-600">{transaction.currency}</span></span>
            <span className="col-span-6 flex items-center justify-start gap-2 md:col-span-2 md:justify-center"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-mono font-medium tracking-wide ${statusClass}`}>{paid && <CheckCircle2 className="h-3 w-3" />}{transaction.status.toUpperCase()}</span><ChevronRight className="h-3.5 w-3.5 text-neutral-700 transition group-hover:translate-x-0.5 group-hover:text-neutral-400" /></span>
            <span className="col-span-12 flex items-center gap-2 text-[9px] font-mono text-neutral-600 md:hidden"><Smartphone className="h-3 w-3" />{gateway?.environment === 'sandbox' ? 'SANDBOX' : 'PRODUCTION'}{transaction.external_id ? ` · ${transaction.external_id.slice(0, 18)}` : ''}</span>
          </button>
        })}
      </div>
    </section>
  )
}

export default GatewayTransactionGrid
