'use client'

import { AlertTriangle, CheckCircle2, Clock3, CreditCard, Link2, Loader2, MessageCircle, RefreshCw, Search, Unlink, UserRound, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { loadOrganizationAccess } from '@/lib/auth/organization-access'
import { CrmMessageAttachment } from '@/components/crm-message-attachment'

type Payment = {
  id: string; status: string; external_id: string | null; amount: number | null; currency: string; payment_method: string | null
  customer_name: string | null; customer_email: string | null; funnel_name: string | null; product_name: string | null
  gateway_name: string | null; provider: string | null; error_message: string | null; created_at: string; updated_at: string; completed_at: string | null
}
type Option = { id: string; name: string }
type Page = { items: Payment[]; next_cursor: { created_at: string; id: string } | null; counts: Record<string, number>; can_view_values: boolean; filters: { gateways: Option[]; funnels: Option[] } }
type TimelineEntry = { source: 'audit' | 'attempt' | 'webhook'; at: string; type: string; status: string | null; origin?: string; gateway?: string; attempt_order?: number; response_code?: string | null; error?: string | null; provider?: string; provider_event_id?: string; attempts?: number; processed_at?: string | null }
type Receipt = { message_id: string; conversation_id: string; created_at: string; file_name: string | null; mime_type: string | null; bucket: string; path: string }
type Detail = {
  transaction: Payment & { customer_phone: string | null; attempt_count: number; failure_code: string | null }
  client_id: string | null; conversation_id: string | null; timeline: TimelineEntry[]; receipts: Receipt[]; receipt_candidates: Receipt[]
  can_view_values: boolean; can_view_receipts: boolean; can_link_receipts: boolean
}

const STATUSES = ['approved', 'pending', 'created', 'failed', 'refunded', 'chargeback'] as const
const statusLabel: Record<string, string> = { created: 'Criada', pending: 'Pendente', approved: 'Aprovada', failed: 'Falhou', declined: 'Recusada', expired: 'Expirada', refunded: 'Reembolsada', chargeback: 'Chargeback' }
const statusClass: Record<string, string> = { created: 'bg-white/5 text-white/60', pending: 'bg-amber-400/10 text-amber-300', approved: 'bg-emerald-400/10 text-emerald-300', failed: 'bg-red-400/10 text-red-300', declined: 'bg-red-400/10 text-red-300', expired: 'bg-white/5 text-white/50', refunded: 'bg-sky-400/10 text-sky-300', chargeback: 'bg-fuchsia-400/10 text-fuchsia-300' }
const sourceLabel: Record<TimelineEntry['source'], string> = { audit: 'Evento', attempt: 'Tentativa no gateway', webhook: 'Webhook recebido' }
const iconFor = (status: string) => status === 'approved' ? CheckCircle2 : status === 'pending' || status === 'created' ? Clock3 : ['failed', 'declined'].includes(status) ? XCircle : AlertTriangle
const money = (amount: number, currency: string) => { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(Number(amount) || 0) } catch { return `${currency} ${Number(amount).toFixed(2)}` } }
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const customerText = (payment: Pick<Payment, 'customer_name' | 'customer_email'>) => payment.customer_name || payment.customer_email || 'Cliente não identificado'
const label = (status: string) => statusLabel[status] ?? status
const PAGE_SIZE = 50

export default function PagamentosPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payments, setPayments] = useState<Payment[]>([])
  const [cursor, setCursor] = useState<Page['next_cursor']>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [options, setOptions] = useState<Page['filters']>({ gateways: [], funnels: [] })
  const [canViewValues, setCanViewValues] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [gateway, setGateway] = useState('')
  const [funnel, setFunnel] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [linking, setLinking] = useState('')
  const request = useRef(0)

  const fetchPage = useCallback((before: Page['next_cursor']) => db.rpc('transactions_list_v1', {
    p_limit: PAGE_SIZE, p_before_created_at: before?.created_at ?? null, p_before_id: before?.id ?? null,
    p_status: status || null, p_gateway_id: gateway || null, p_funnel_id: funnel || null, p_search: search || null,
  }), [db, status, gateway, funnel, search])

  const load = useCallback(async () => {
    const current = ++request.current
    setLoading(true); setError(null)
    try {
      const result = await fetchPage(null)
      if (result.error) throw result.error
      if (current !== request.current) return
      const page = result.data as Page
      setPayments(page.items); setCursor(page.next_cursor); setCounts(page.counts); setOptions(page.filters); setCanViewValues(page.can_view_values)
    } catch (cause) {
      if (current !== request.current) return
      console.error('[ALTHEA-PAGAMENTOS]', cause); setError('Não foi possível carregar os pagamentos.')
    } finally { if (current === request.current) setLoading(false) }
  }, [fetchPage])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    const result = await fetchPage(cursor)
    setLoadingMore(false)
    if (result.error) { setError('Não foi possível carregar mais pagamentos.'); return }
    const page = result.data as Page
    setPayments(current => [...current, ...page.items.filter(item => !current.some(row => row.id === item.id))]); setCursor(page.next_cursor)
  }

  const loadDetail = useCallback(async (id: string) => {
    setDetailError('')
    const result = await db.rpc('transaction_detail_v1', { p_transaction_id: id })
    if (result.error) { setDetail(null); setDetailError(result.error.message === 'TRANSACTION_NOT_FOUND' ? 'Transação não encontrada nesta organização.' : 'Não foi possível carregar a transação.'); return }
    setDetail(result.data as Detail)
  }, [db])

  async function linkReceipt(receipt: Receipt, transactionId: string | null) {
    setLinking(receipt.message_id); setDetailError('')
    const result = await db.rpc('crm_receipt_link_transaction', { p_message_id: receipt.message_id, p_transaction_id: transactionId })
    setLinking('')
    if (result.error) { setDetailError(result.error.message === 'FORBIDDEN' ? 'Seu acesso não permite vincular comprovantes.' : 'Não foi possível atualizar o comprovante.'); return }
    if (selectedId) await loadDetail(selectedId)
  }

  // the search box only hits the server after the operator stops typing
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 350); return () => clearTimeout(timer) }, [query])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('transaction')?.trim(); if (id) setSelectedId(id) }, [])
  useEffect(() => { setDetail(null); if (selectedId) void loadDetail(selectedId) }, [selectedId, loadDetail])
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null; let cancelled = false
    const subscribe = async () => { const { organization_id: org } = await loadOrganizationAccess(db); if (cancelled) return; channel = db.channel(`payments-${org}`).on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `organization_id=eq.${org}` }, () => void load()).subscribe() }
    void subscribe().catch(() => undefined); return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const exceptions = (counts.failed ?? 0) + (counts.declined ?? 0) + (counts.chargeback ?? 0)
  const select = 'rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/80 outline-none'

  return <main className="min-h-screen bg-[#070809] px-4 py-6 text-white md:px-8 lg:px-10"><div className="mx-auto w-full max-w-[1500px] space-y-6">
    <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-300/80">Operação financeira</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Pagamentos</h1><p className="mt-1 text-sm text-white/50">Espelho das transações reportadas pelos gateways. O gateway continua sendo a fonte de verdade.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/[0.08]"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Sincronizar</button></header>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Transações', total], ['Aprovadas', counts.approved ?? 0], ['Pendentes', (counts.pending ?? 0) + (counts.created ?? 0)], ['Exceções', exceptions]].map(([title, value]) => <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><p className="text-xs uppercase tracking-wider text-white/40">{title}</p><strong className="mt-2 block text-2xl font-semibold">{loading && !payments.length ? '—' : String(value)}</strong></article>)}</section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white/50 lg:max-w-md"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Cliente, e-mail, ID ou ID externo..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25" /></label>
        <select aria-label="Gateway" value={gateway} onChange={(event) => setGateway(event.target.value)} className={select}><option value="">Todos os gateways</option>{options.gateways.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Funil" value={funnel} onChange={(event) => setFunnel(event.target.value)} className={select}><option value="">Todos os funis</option>{options.funnels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{(['', ...STATUSES] as string[]).map((item) => <button key={item || 'all'} type="button" onClick={() => setStatus(item)} className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs transition ${status === item ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-white/45 hover:bg-white/5'}`}>{item ? label(item) : 'Todos'} <span className="text-white/30">{item ? counts[item] ?? 0 : total}</span></button>)}</div>
      <div className="mt-5 overflow-x-auto">{loading && !payments.length ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Carregando pagamentos...</div> : error && !payments.length ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><XCircle className="text-red-300" size={24} /><p className="text-sm text-white/60">{error}</p><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">Tentar novamente</button></div> : payments.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><CreditCard className="text-white/25" size={25} /><strong className="text-sm text-white/65">Nenhum pagamento encontrado</strong><p className="text-xs text-white/35">{search || status || gateway || funnel ? 'Nenhuma transação com esses filtros.' : 'Os dados aparecem aqui quando os gateways reportarem transações.'}</p></div> : <>
        <table className="w-full min-w-[1000px] text-left text-sm"><thead><tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/30"><th className="px-3 py-3 font-medium">Cliente</th><th className="px-3 py-3 font-medium">Valor</th><th className="px-3 py-3 font-medium">Método</th><th className="px-3 py-3 font-medium">Gateway</th><th className="px-3 py-3 font-medium">Funil / produto</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Atualizado</th></tr></thead>
          <tbody>{payments.map((payment) => { const Icon = iconFor(payment.status); return <tr key={payment.id} onClick={() => setSelectedId(payment.id)} className="cursor-pointer border-b border-white/[0.06] transition hover:bg-white/[0.025]">
            <td className="px-3 py-4"><button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(payment.id) }} className="text-left"><strong className="block text-white/85">{customerText(payment)}</strong><span className="mt-1 block max-w-[260px] truncate text-xs text-white/30">{payment.external_id || payment.id}</span></button></td>
            <td className="px-3 py-4 font-medium text-white/80">{payment.amount == null ? <span className="text-white/30">oculto</span> : money(payment.amount, payment.currency)}</td>
            <td className="px-3 py-4 text-white/55">{payment.payment_method || '—'}</td>
            <td className="px-3 py-4 text-white/55">{payment.gateway_name || 'Não informado'}</td>
            <td className="px-3 py-4 text-white/55"><span className="block max-w-[200px] truncate">{payment.funnel_name || '—'}</span><span className="block max-w-[200px] truncate text-xs text-white/30">{payment.product_name || ''}</span></td>
            <td className="px-3 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${statusClass[payment.status] ?? 'bg-white/5 text-white/60'}`}><Icon size={13} />{label(payment.status)}</span></td>
            <td className="px-3 py-4 text-white/40">{dateTime(payment.updated_at || payment.created_at)}</td>
          </tr> })}</tbody></table>
        {error && <p role="alert" className="mt-3 text-center text-xs text-red-300">{error}</p>}
        {cursor && <div className="mt-4 flex justify-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-50">{loadingMore && <Loader2 size={14} className="animate-spin" />} Carregar mais</button></div>}
        {!canViewValues && <p className="mt-3 text-center text-xs text-white/30">Valores ocultos: seu acesso não inclui ver valores.</p>}
      </>}</div>
    </section>
  </div>
  {selectedId && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="Detalhes da transação" onClick={(event) => { if (event.currentTarget === event.target) setSelectedId(null) }}>
    <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0c0f10] p-6 shadow-2xl md:rounded-3xl">
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs uppercase tracking-wider text-white/35">Transação</p><h2 className="mt-1 truncate text-xl font-semibold">{detail ? customerText(detail.transaction) : 'Carregando...'}</h2>{detail?.transaction.customer_email && <p className="truncate text-xs text-white/40">{detail.transaction.customer_email}{detail.transaction.customer_phone ? ` · ${detail.transaction.customer_phone}` : ''}</p>}</div>
        <div className="flex items-center gap-1">{detail?.conversation_id && <><a href={`/dashboard/crm?conversation=${detail.conversation_id}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5"><MessageCircle size={13} /> Conversa</a><a href={`/dashboard/crm/customer-360?conversation=${detail.conversation_id}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5"><UserRound size={13} /> 360°</a></>}<button type="button" aria-label="Fechar" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-white/50 hover:bg-white/5"><XCircle size={19} /></button></div></div>
      {detailError && <div role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200">{detailError}</div>}
      {!detail && !detailError && <div className="flex min-h-40 items-center justify-center"><Loader2 size={18} className="animate-spin text-emerald-300" /></div>}
      {detail && <>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{([
          ['Status', label(detail.transaction.status)],
          ['Valor', detail.transaction.amount == null ? 'Oculto' : money(detail.transaction.amount, detail.transaction.currency)],
          ['Método', detail.transaction.payment_method || '—'],
          ['Gateway', detail.transaction.gateway_name || 'Não informado'],
          ['Funil', detail.transaction.funnel_name || '—'],
          ['Produto', detail.transaction.product_name || '—'],
          ['Criada', dateTime(detail.transaction.created_at)],
          ['Atualizada', dateTime(detail.transaction.updated_at)],
          ['Confirmada', detail.transaction.completed_at ? dateTime(detail.transaction.completed_at) : '—'],
          ['ID no gateway', detail.transaction.external_id || '—'],
          ['ID interno', detail.transaction.id],
        ] as [string, string][]).map(([title, value], index) => <div key={title} className={`rounded-xl bg-white/[0.04] p-3 ${index >= 9 ? 'sm:col-span-3' : ''}`}><span className="text-xs text-white/35">{title}</span><strong className="mt-1 block break-all text-sm">{value}</strong></div>)}
          {(detail.transaction.error_message || detail.transaction.failure_code) && <div className="rounded-xl bg-red-400/5 p-3 sm:col-span-3"><span className="text-xs text-red-300/60">Falha reportada{detail.transaction.failure_code ? ` · ${detail.transaction.failure_code}` : ''}</span><p className="mt-1 text-sm text-red-200/80">{detail.transaction.error_message}</p></div>}
        </div>

        <h3 className="mt-6 text-xs font-medium uppercase tracking-wider text-white/40">Histórico</h3>
        {detail.timeline.length ? <ol className="mt-3 space-y-2 border-l border-white/10 pl-4">{detail.timeline.map((entry, index) => <li key={`${entry.source}-${index}`} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-emerald-400/60" />
          <div className="flex flex-wrap items-baseline justify-between gap-2"><b className="text-white/80">{sourceLabel[entry.source]}{entry.source === 'audit' ? ` · ${entry.type}` : entry.source === 'attempt' ? ` #${entry.attempt_order ?? ''} · ${entry.gateway ?? ''}` : ` · ${entry.provider ?? ''}`}</b><span className="text-xs text-white/35">{dateTime(entry.at)}</span></div>
          <p className="text-xs text-white/45">{[entry.status && label(entry.status), entry.origin, entry.response_code && `código ${entry.response_code}`, entry.source === 'webhook' && entry.attempts ? `${entry.attempts} processamento(s)` : null, entry.source === 'webhook' && entry.provider_event_id].filter(Boolean).join(' · ')}</p>
          {entry.error && <p className="text-xs text-red-300/80">{entry.error}</p>}
        </li>)}</ol> : <p className="mt-2 text-sm text-white/35">Nenhum evento registrado para esta transação ainda.</p>}

        {detail.can_view_receipts && <>
          <h3 className="mt-6 text-xs font-medium uppercase tracking-wider text-white/40">Comprovantes</h3>
          {detail.receipts.length === 0 && detail.receipt_candidates.length === 0 && <p className="mt-2 text-sm text-white/35">Nenhum comprovante enviado por este cliente.</p>}
          <div className="mt-3 space-y-2">{[...detail.receipts.map(receipt => ({ receipt, linked: true })), ...detail.receipt_candidates.map(receipt => ({ receipt, linked: false }))].map(({ receipt, linked }) => <div key={receipt.message_id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><CrmMessageAttachment metadata={{ attachment: { kind: 'transfer_receipt', bucket: receipt.bucket, path: receipt.path, file_name: receipt.file_name, mime_type: receipt.mime_type } }} canView /></div>
            <span className="shrink-0 text-[10px] text-white/35">{dateTime(receipt.created_at)}</span>
            {detail.can_link_receipts && <button type="button" disabled={linking === receipt.message_id} onClick={() => void linkReceipt(receipt, linked ? null : detail.transaction.id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50">{linked ? <><Unlink size={12} /> Desvincular</> : <><Link2 size={12} /> Vincular a esta transação</>}</button>}
          </div>)}</div>
        </>}
      </>}
    </section>
  </div>}
  </main>
}
