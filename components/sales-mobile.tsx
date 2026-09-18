'use client'

import { CalendarDays, CheckCircle2, CreditCard, Filter, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { amountOf, customerNameOf, dateOf, normalizeStatus, todayInSaoPaulo, type AnalyticsSale } from '@/lib/analytics/sales'

type Sale = AnalyticsSale & { currency?: string | null }
type JsonObject = Record<string, unknown>
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value)
const fmtMoney = (n: number, currency = 'BRL') => {
  const code = currency?.trim().toUpperCase() || 'BRL'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
  } catch {
    return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} ${code}`
  }
}
const fmtDate = (value: string) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(`${value}T12:00:00-03:00`)) : '—'
const fmtDateTime = (value: string) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const isApproved = (status: string | null) => normalizeStatus(status) === 'approved'
const isPending = (status: string | null) => normalizeStatus(status) === 'pending'
const isCancelled = (status: string | null) => ['failed', 'cancelled'].includes(normalizeStatus(status))
const shiftDays = (value: string, days: number) => { const date = new Date(`${value}T12:00:00-03:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10) }

export default function SalesMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const today = todayInSaoPaulo()
  const minDate = shiftDays(today, -89)
  const [sales, setSales] = useState<Sale[]>([])
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [status, setStatus] = useState('Todas')
  const [draftStatus, setDraftStatus] = useState('Todas')
  const [draftStartDate, setDraftStartDate] = useState(today)
  const [draftEndDate, setDraftEndDate] = useState(today)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Sale | null>(null)

  const dateRangeValid = startDate >= minDate && startDate <= endDate && endDate <= today
  const draftDateRangeValid = draftStartDate >= minDate && draftStartDate <= draftEndDate && draftEndDate <= today
  const periodLabel = startDate === today && endDate === today ? 'Hoje' : `${fmtDate(startDate)} — ${fmtDate(endDate)}`

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setSales([]); return }
      const queryResult = await db
        .from('sales')
        .select('id,amount,status,currency,data,gateway_id,external_id,transaction_id,occurred_at,created_at')
        .eq('user_id', auth.user.id)
        .order('occurred_at', { ascending: false })
        .limit(5000)
      if (queryResult.error) throw queryResult.error
      setSales((queryResult.data || []) as Sale[])
    } catch (cause) {
      console.error('[ALTHEA-VENDAS]', cause)
      setError('Não foi possível carregar as vendas reais.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false
    const subscribe = async () => {
      const { data: auth } = await db.auth.getUser()
      if (cancelled || !auth.user) return
      channel = db.channel(`sales-mobile-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `user_id=eq.${auth.user.id}` }, () => void load()).subscribe()
    }
    void subscribe()
    return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  const filtered = useMemo(() => sales.filter((sale) => {
    const data = obj(sale.data)
    const customer = obj(data.customer)
    const searchText = [sale.id, sale.external_id, sale.transaction_id, sale.gateway_id, text(customer.name), text(customer.email), text(customer.phone)].join(' ').toLowerCase()
    if (query.trim() && !searchText.includes(query.trim().toLowerCase())) return false
    const day = dateOf(sale)
    if (startDate && (!day || day < startDate)) return false
    if (endDate && (!day || day > endDate)) return false
    if (status === 'Pagas' && !isApproved(sale.status)) return false
    if (status === 'Pendentes' && !isPending(sale.status)) return false
    if (status === 'Canceladas' && !isCancelled(sale.status)) return false
    return true
  }), [sales, query, startDate, endDate, status])

  const totals = useMemo(() => {
    const currencies = [...new Set(filtered.map((sale) => sale.currency?.trim().toUpperCase() || 'BRL'))]
    const total = currencies.length === 1 ? filtered.reduce((sum, sale) => sum + amountOf(sale), 0) : null
    return {
      total,
      currency: currencies[0] || 'BRL',
      currencyCount: currencies.length,
      paid: filtered.filter((sale) => isApproved(sale.status)).length,
      pending: filtered.filter((sale) => isPending(sale.status)).length,
    }
  }, [filtered])
  const clear = () => { setQuery(''); setStartDate(today); setEndDate(today); setStatus('Todas'); setDraftStatus('Todas'); setDraftStartDate(today); setDraftEndDate(today) }
  const label = (sale: Sale) => ({ approved: 'Aprovada', pending: 'Pendente', failed: 'Falhou', cancelled: 'Cancelada', refunded: 'Reembolsada', chargeback: 'Chargeback' } as Record<string, string>)[normalizeStatus(sale.status)] ?? 'Outro'
  const openPeriod = () => { setDraftStartDate(startDate); setDraftEndDate(endDate); setPeriodOpen(true) }
  const applyPeriod = () => { if (!draftDateRangeValid) return; setStartDate(draftStartDate); setEndDate(draftEndDate); setPeriodOpen(false) }

  return <section className="althea-mobile-sales" aria-label="Vendas mobile">
    <main className="ams-content">
      <div className="mb-5"><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#1DBB54]">Operação</p><h1 className="mt-2 text-[30px] font-semibold tracking-[-0.045em] text-white">Vendas</h1><p className="mt-1 text-sm text-[#7f8b85]">Transações reais da sua operação.</p></div>
      <label className="ams-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Buscar transações..." aria-label="Buscar transações" /></label>
      <section className="mt-4 flex flex-wrap items-end gap-3">
        <div className="relative"><button type="button" onClick={openPeriod} aria-expanded={periodOpen} aria-haspopup="dialog" className="flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-[#0D362D] bg-[#0F1A16] px-3 py-2.5 text-left text-xs font-bold text-white transition hover:border-[#1DB854]/40"><CalendarDays size={16} className="shrink-0 text-[#A6A6A6]" /><span className="text-[9px] font-mono uppercase tracking-wider text-[#69736e]">Período</span><span className="max-w-[210px] truncate">{periodLabel}</span></button>{periodOpen ? <div role="dialog" aria-label="Selecionar período" className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(340px,calc(100vw-2rem))] rounded-2xl border border-white/[0.08] bg-[#0B1210] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.6)]"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-white">Período de vendas</p><p className="mt-1 text-[10px] text-[#69736e]">Selecione até 90 dias de dados reais.</p></div><button type="button" onClick={() => setPeriodOpen(false)} className="rounded-lg px-2 py-1 text-xs text-[#77817c] hover:bg-white/[0.04] hover:text-white">Fechar</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block rounded-xl border border-[#0D362D] bg-[#0F1A16] p-3"><span className="block text-[9px] font-mono uppercase tracking-wider text-[#69736e]">De</span><input type="date" value={draftStartDate} min={minDate} max={draftEndDate} onChange={(event) => setDraftStartDate(event.target.value)} className="mt-2 w-full bg-transparent text-sm font-semibold outline-none [color-scheme:dark]" aria-label="Data inicial" /></label><label className="block rounded-xl border border-[#0D362D] bg-[#0F1A16] p-3"><span className="block text-[9px] font-mono uppercase tracking-wider text-[#69736e]">Até</span><input type="date" value={draftEndDate} min={draftStartDate} max={today} onChange={(event) => setDraftEndDate(event.target.value)} className="mt-2 w-full bg-transparent text-sm font-semibold outline-none [color-scheme:dark]" aria-label="Data final" /></label></div>{!draftDateRangeValid ? <p className="mt-3 text-[10px] font-mono text-amber-400">Selecione um intervalo válido de até 90 dias.</p> : null}<div className="mt-4 flex justify-end"><button type="button" onClick={applyPeriod} disabled={!draftDateRangeValid} className="rounded-xl bg-[#1DB854] px-4 py-2.5 text-xs font-bold text-[#07110c] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">Aplicar período</button></div></div> : null}</div>
        <button className="ams-filter" type="button" onClick={() => { setDraftStatus(status); setFilterOpen(true) }}><Filter size={13} /><span>Filtros{status !== 'Todas' ? ` · ${status}` : ''}</span></button>
      </section>
      {!dateRangeValid ? <p className="mt-2 text-[10px] font-mono text-amber-400">Selecione um intervalo válido de até 90 dias.</p> : null}
      <section className="ams-transactions"><div className="ams-table-head"><span>Cliente</span><span>Valor</span><span>Status</span></div>{loading ? <div className="ams-empty"><div className="ams-empty-icon" /><strong>Carregando vendas</strong><p>Sincronizando dados reais.</p></div> : error ? <div className="ams-empty"><div className="ams-empty-icon"><X size={21} /></div><strong>Falha na sincronização</strong><p>{error}</p><button type="button" onClick={() => void load()}>Tentar novamente</button></div> : filtered.length ? <div className="ams-list">{filtered.map((sale) => <button key={sale.id} type="button" className="ams-sale-row" onClick={() => setSelected(sale)}><span className="ams-sale-client"><b>{customerNameOf(sale)}</b><small>{fmtDate(dateOf(sale))} · {sale.gateway_id || 'Gateway não informado'}</small></span><span className="ams-sale-value">{fmtMoney(amountOf(sale), sale.currency || 'BRL')}</span><span className={`ams-sale-status ${isApproved(sale.status) ? 'paid' : isPending(sale.status) ? 'pending' : 'other'}`}>{label(sale)}</span></button>)}</div> : <div className="ams-empty"><div className="ams-empty-icon"><CreditCard size={21} /></div><strong>Nenhuma transação encontrada</strong><p>Tente ajustar os filtros ou o período selecionado.</p><button type="button" onClick={clear}>Limpar filtros</button></div>}</section>
      <section className="ams-summary"><article><span>Volume</span><strong>{totals.total == null ? `${totals.currencyCount} moedas` : fmtMoney(totals.total, totals.currency)}</strong></article><article><span>Aprovadas</span><strong>{totals.paid}</strong></article><article><span>Pend.</span><strong>{totals.pending}</strong></article></section>
    </main>
    {selected && <div className="ams-modal" role="dialog" aria-modal="true" aria-label="Detalhes da venda" onClick={(e) => { if (e.currentTarget === e.target) setSelected(null) }}><div className="ams-sheet"><div className="ams-handle" /><div className="ams-sheet-title"><h2>Detalhes da venda</h2><button type="button" aria-label="Fechar" onClick={() => setSelected(null)}><X size={17} /></button></div><div className="ams-sale-detail"><div><span>Status</span><b>{label(selected)}</b></div><div><span>Valor</span><b>{fmtMoney(amountOf(selected), selected.currency || 'BRL')}</b></div><div><span>Data</span><b>{fmtDateTime(selected.occurred_at ?? selected.created_at ?? '')}</b></div><div><span>ID</span><b>{selected.id}</b></div><div><span>Transação externa</span><b>{selected.external_id || selected.transaction_id || 'Não informado'}</b></div><div><span>Gateway</span><b>{selected.gateway_id || 'Não informado'}</b></div></div><button className="ams-apply" type="button" onClick={() => setSelected(null)}><CheckCircle2 size={15} /> Fechar</button></div></div>}
    {filterOpen && <div className="ams-modal" role="dialog" aria-modal="true" aria-label="Filtrar transações" onClick={(e) => { if (e.currentTarget === e.target) setFilterOpen(false) }}><div className="ams-sheet"><div className="ams-handle" /><div className="ams-sheet-title"><h2>Filtrar transações</h2><button type="button" aria-label="Fechar" onClick={() => setFilterOpen(false)}><X size={17} /></button></div>{['Todas', 'Pagas', 'Pendentes', 'Canceladas'].map((item) => <button key={item} type="button" className={draftStatus === item ? 'selected' : ''} onClick={() => setDraftStatus(item)}><span>{item}</span><b>{draftStatus === item ? '✓' : '○'}</b></button>)}<button className="ams-apply" type="button" onClick={() => { setStatus(draftStatus); setFilterOpen(false) }}>Aplicar filtros</button></div></div>}
  </section>
}
