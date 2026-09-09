'use client'

import { CheckCircle2, CreditCard, Filter, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { amountOf, dateOf, normalizeStatus, todayInSaoPaulo, type AnalyticsSale } from '@/lib/analytics/sales'

type Sale = AnalyticsSale & { currency?: string | null }
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
const fmtMoney = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const fmtDate = (value: string) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(`${value}T12:00:00-03:00`)) : '—'
const fmtDateTime = (value: string) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const isApproved = (status: string | null) => normalizeStatus(status) === 'approved'
const isPending = (status: string | null) => normalizeStatus(status) === 'pending'
const isCancelled = (status: string | null) => ['failed', 'cancelled'].includes(normalizeStatus(status))

export default function SalesMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const today = todayInSaoPaulo()
  const [active, setActive] = useState('vendas')
  const [sales, setSales] = useState<Sale[]>([])
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [status, setStatus] = useState('Todas')
  const [draftStatus, setDraftStatus] = useState('Todas')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Sale | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setSales([]); return }

      const q = await db
        .from('sales')
        .select('id,amount,status,currency,data,gateway_id,external_id,transaction_id,customer_id,occurred_at,created_at')
        .order('occurred_at', { ascending: false })
        .limit(5000)

      if (q.error) throw q.error
      setSales((q.data || []) as Sale[])
    } catch (cause) {
      console.error('[ALTHEA-VENDAS]', cause)
      setError('Não foi possível carregar as vendas reais.')
    } finally {
      setLoading(false)
    }
  }, [db])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled = false
    const subscribe = async () => {
      const { data: auth } = await db.auth.getUser()
      if (cancelled || !auth.user) return
      channel = db.channel(`sales-mobile-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => void load()).subscribe()
    }
    void subscribe()
    return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  useEffect(() => {
    const h = (event: Event) => setActive((event as CustomEvent<string>).detail || 'dashboard')
    window.addEventListener('althea-mobile-page', h)
    return () => window.removeEventListener('althea-mobile-page', h)
  }, [])

  const go = (page: string) => { setActive(page); window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: page })) }

  const filtered = useMemo(() => sales.filter((sale) => {
    const data = obj(sale.data)
    const customer = obj(data.customer)
    const text = [sale.id, sale.external_id, sale.transaction_id, sale.gateway_id, sale.customer_id, customer.name, customer.email].join(' ').toLowerCase()
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false
    const day = dateOf(sale)
    if (startDate && (!day || day < startDate)) return false
    if (endDate && (!day || day > endDate)) return false
    if (status === 'Pagas' && !isApproved(sale.status)) return false
    if (status === 'Pendentes' && !isPending(sale.status)) return false
    if (status === 'Canceladas' && !isCancelled(sale.status)) return false
    return true
  }), [sales, query, startDate, endDate, status])

  const totals = useMemo(() => ({
    total: filtered.reduce((sum, sale) => sum + amountOf(sale), 0),
    paid: filtered.filter((sale) => isApproved(sale.status)).length,
    pending: filtered.filter((sale) => isPending(sale.status)).length,
  }), [filtered])

  const clear = () => { setQuery(''); setStartDate(today); setEndDate(today); setStatus('Todas'); setDraftStatus('Todas') }
  const label = (sale: Sale) => {
    switch (normalizeStatus(sale.status)) {
      case 'approved': return 'Aprovada'
      case 'pending': return 'Pendente'
      case 'failed': return 'Falhou'
      case 'cancelled': return 'Cancelada'
      case 'refunded': return 'Reembolsada'
      case 'chargeback': return 'Chargeback'
      default: return 'Outro'
    }
  }

  if (active !== 'vendas') return null

  return <section className="althea-mobile-sales" aria-label="Vendas mobile">
    <header className="ams-header"><button type="button" className="ams-brand" aria-label="Voltar ao Dashboard" onClick={() => go('dashboard')}><img src="/althea-logo.png" alt="ALTHEA PAY" /></button><button className="ams-menu" type="button" aria-label="Sincronizar vendas" onClick={() => void load()}><RefreshCw size={16} /></button></header>
    <main className="ams-content">
      <h1>Vendas</h1><p className="ams-subtitle">Transações</p>
      <label className="ams-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Buscar transações..." aria-label="Buscar transações" /></label>
      <div className="ams-filters"><div className="ams-date-range"><div><span>De</span><input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} /></div><i>|</i><div><span>Até</span><input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} /></div></div><button className="ams-filter" type="button" onClick={() => { setDraftStatus(status); setFilterOpen(true) }}><Filter size={13} /><span>Filtros{status !== 'Todas' ? ` · ${status}` : ''}</span></button></div>
      <div className="ams-period-line"><button type="button" onClick={() => setPeriodOpen((value) => !value)}>{startDate === today && endDate === today ? 'Hoje' : startDate || endDate ? `${fmtDate(startDate || endDate)} — ${fmtDate(endDate || startDate)}` : 'Todo o período'} <span>⌄</span></button>{periodOpen && <div className="ams-inline-menu"><button type="button" onClick={() => { setStartDate(today); setEndDate(today); setPeriodOpen(false) }}>Hoje</button><button type="button" onClick={() => { const d = new Date(`${today}T12:00:00-03:00`); d.setDate(d.getDate() - 6); setStartDate(d.toISOString().slice(0, 10)); setEndDate(today); setPeriodOpen(false) }}>Últimos 7 dias</button><button type="button" onClick={() => { const d = new Date(`${today}T12:00:00-03:00`); d.setDate(d.getDate() - 29); setStartDate(d.toISOString().slice(0, 10)); setEndDate(today); setPeriodOpen(false) }}>Últimos 30 dias</button><button type="button" onClick={() => { setStartDate(''); setEndDate(''); setPeriodOpen(false) }}>Todo o período</button></div>}</div>
      <section className="ams-transactions"><div className="ams-table-head"><span>Cliente</span><span>Valor</span><span>Status</span></div>{loading ? <div className="ams-empty"><div className="ams-empty-icon" /><strong>Carregando vendas</strong><p>Sincronizando dados reais.</p></div> : error ? <div className="ams-empty"><div className="ams-empty-icon"><X size={21} /></div><strong>Falha na sincronização</strong><p>{error}</p><button type="button" onClick={() => void load()}>Tentar novamente</button></div> : filtered.length ? <div className="ams-list">{filtered.map((sale) => { const customer = obj(obj(sale.data).customer); return <button key={sale.id} type="button" className="ams-sale-row" onClick={() => setSelected(sale)}><span className="ams-sale-client"><b>{String(customer.name || customer.full_name || customer.email || sale.external_id || sale.customer_id || sale.id).slice(0, 26)}</b><small>{fmtDate(dateOf(sale))} · {sale.gateway_id || 'Gateway não informado'}</small></span><span className="ams-sale-value">{fmtMoney(amountOf(sale))}</span><span className={`ams-sale-status ${isApproved(sale.status) ? 'paid' : isPending(sale.status) ? 'pending' : 'other'}`}>{label(sale)}</span></button> })}</div> : <div className="ams-empty"><div className="ams-empty-icon"><CreditCard size={21} /></div><strong>Nenhuma transação encontrada</strong><p>Tente ajustar os filtros ou o período selecionado.</p><button type="button" onClick={clear}>Limpar filtros</button></div>}</section>
      <section className="ams-summary"><article><span>Volume</span><strong>{fmtMoney(totals.total)}</strong></article><article><span>Aprovadas</span><strong>{totals.paid}</strong></article><article><span>Pend.</span><strong>{totals.pending}</strong></article></section>
    </main>
    <nav className="ams-bottom-nav" aria-label="Navegação principal">{[['dashboard', 'Dashboard'], ['vendas', 'Vendas'], ['funis', 'Funis/Chat'], ['gateways', 'Gateways'], ['configuracoes', 'Config.']].map(([key, labelText]) => <button key={key} type="button" className={active === key ? 'active' : ''} onClick={() => go(key)}><span>{key === 'dashboard' ? '▦' : key === 'vendas' ? '▤' : key === 'funis' ? '♧' : key === 'gateways' ? '◈' : '⚙'}</span><small>{labelText}</small></button>)}</nav>
    {selected && <div className="ams-modal" role="dialog" aria-modal="true" aria-label="Detalhes da venda" onClick={(e) => { if (e.currentTarget === e.target) setSelected(null) }}><div className="ams-sheet"><div className="ams-handle" /><div className="ams-sheet-title"><h2>Detalhes da venda</h2><button type="button" aria-label="Fechar" onClick={() => setSelected(null)}><X size={17} /></button></div><div className="ams-sale-detail"><div><span>Status</span><b>{label(selected)}</b></div><div><span>Valor</span><b>{fmtMoney(amountOf(selected))}</b></div><div><span>Data</span><b>{fmtDateTime(selected.occurred_at ?? selected.created_at)}</b></div><div><span>ID</span><b>{selected.id}</b></div><div><span>Transação externa</span><b>{selected.external_id || selected.transaction_id || 'Não informado'}</b></div><div><span>Gateway</span><b>{selected.gateway_id || 'Não informado'}</b></div></div><button className="ams-apply" type="button" onClick={() => setSelected(null)}><CheckCircle2 size={15} /> Fechar</button></div></div>}
    {filterOpen && <div className="ams-modal" role="dialog" aria-modal="true" aria-label="Filtrar transações" onClick={(e) => { if (e.currentTarget === e.target) setFilterOpen(false) }}><div className="ams-sheet"><div className="ams-handle" /><div className="ams-sheet-title"><h2>Filtrar transações</h2><button type="button" aria-label="Fechar" onClick={() => setFilterOpen(false)}><X size={17} /></button></div>{['Todas', 'Pagas', 'Pendentes', 'Canceladas'].map((item) => <button key={item} type="button" className={draftStatus === item ? 'selected' : ''} onClick={() => setDraftStatus(item)}><span>{item}</span><b>{draftStatus === item ? '✓' : '○'}</b></button>)}<button className="ams-apply" type="button" onClick={() => { setStatus(draftStatus); setFilterOpen(false) }}>Aplicar filtros</button></div></div>}
  </section>
}
