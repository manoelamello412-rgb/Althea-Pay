'use client'

import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, CreditCard, LayoutDashboard, Network, RefreshCw, Settings, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Range = { start: string; end: string }
type Sale = { id: string; amount: number | string | null; status?: string | null; data?: any; source?: string | null; medium?: string | null; campaign?: string | null; gateway_id?: string | null; occurred_at?: string | null; created_at?: string | null }
type Gateway = { id: string; data?: any }

const TZ = 'America/Sao_Paulo'
const pad = (n: number) => String(n).padStart(2, '0')
const parse = (v: string) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d) }
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (v: string, n: number) => { const d = parse(v); d.setDate(d.getDate() + n); return iso(d) }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)
const fmt = (v: string) => parse(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const status = (v: any) => String(v ?? '').toLowerCase()
const approved = (v: any) => ['approved', 'completed', 'paid', 'success', 'succeeded'].includes(status(v))
const amountOf = (s: Sale) => Number(s.amount ?? s.data?.amount ?? 0) || 0
const dateOf = (s: Sale) => (s.occurred_at || s.created_at || '').slice(0, 10)
const methodOf = (s: Sale) => status(s.data?.payment_method ?? s.data?.paymentMethod ?? s.data?.method ?? s.data?.payment?.method ?? 'outros').replace(/[- ]/g, '_')

function calendar(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return { value: iso(d), day: d.getDate(), current: d.getMonth() === month.getMonth() } })
}

export default function DashboardMobile() {
  const db = useMemo(() => createSupabaseBrowserClient() as any, [])
  const [now, setNow] = useState(today)
  const minDate = addDays(now, -89)
  const [active, setActive] = useState('dashboard')
  const [range, setRange] = useState<Range>({ start: now, end: now })
  const [draft, setDraft] = useState<Range>({ start: now, end: now })
  const [periodOpen, setPeriodOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [month, setMonth] = useState(parse(now))
  const [sales, setSales] = useState<Sale[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = today()
    setNow(next)
    setRange(r => r.start === now && r.end === now ? { start: next, end: next } : r)
    setDraft(r => r.start === now && r.end === now ? { start: next, end: next } : r)
  }, [now])

  const load = useCallback(async () => {
    const { data: { user } } = await db.auth.getUser()
    if (!user) { setSales([]); setGateways([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const since = addDays(today(), -89)
      const [s, g] = await Promise.all([
        db.from('sales').select('id,amount,status,data,source,medium,campaign,gateway_id,occurred_at,created_at').eq('user_id', user.id).gte('created_at', `${since}T00:00:00-03:00`).order('created_at', { ascending: false }).limit(5000),
        db.from('gateways').select('id,data').eq('user_id', user.id).limit(100),
      ])
      if (s.error || g.error) throw s.error || g.error
      setSales(s.data || [])
      setGateways(g.data || [])
    } catch (e) {
      console.error('[ALTHEA-DASHBOARD-MOBILE]', e)
      setError('Não foi possível sincronizar o Dashboard.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const handler = (event: Event) => setActive((event as CustomEvent<string>).detail || 'dashboard')
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])
  useEffect(() => {
    const sync = () => void load()
    const channel = db.channel('dashboard-mobile-live').on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, sync).on('postgres_changes', { event: '*', schema: 'public', table: 'gateways' }, sync).subscribe()
    return () => { void db.removeChannel(channel) }
  }, [db, load])

  const periodSales = useMemo(() => sales.filter(s => { const d = dateOf(s); return d >= range.start && d <= range.end }), [sales, range])
  const approvedSales = useMemo(() => periodSales.filter(s => approved(s.status)), [periodSales])
  const gross = useMemo(() => approvedSales.reduce((sum, s) => sum + amountOf(s), 0), [approvedSales])
  const ticket = approvedSales.length ? gross / approvedSales.length : 0
  const customerCount = useMemo(() => new Set(periodSales.map(s => String(s.data?.customer_id ?? s.data?.customer?.id ?? s.data?.customer?.email ?? '')).filter(Boolean)).size, [periodSales])
  const metrics = [
    { label: 'Receita', value: money(gross) },
    { label: 'Transações', value: String(periodSales.length) },
    { label: 'Ticket Médio', value: money(ticket) },
    { label: 'Novos Clientes', value: String(customerCount) },
  ]

  const series = useMemo(() => {
    const map = new Map<string, number>()
    approvedSales.forEach(s => { const d = dateOf(s); map.set(d, (map.get(d) || 0) + amountOf(s)) })
    const out: { date: string; value: number }[] = []
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) out.push({ date: d, value: map.get(d) || 0 })
    return out
  }, [approvedSales, range])
  const max = Math.max(1, ...series.map(x => x.value))
  const points = series.map((x, i) => `${series.length === 1 ? 150 : 8 + i * 284 / (series.length - 1)},${110 - x.value / max * 100}`).join(' ')

  const sources = useMemo(() => {
    const keys: [string, string][] = [['credit_card', 'Cartão'], ['pix', 'Pix'], ['boleto', 'Boleto'], ['outros', 'Outros']]
    return keys.map(([key, label]) => ({ label, value: approvedSales.filter(s => methodOf(s) === key).reduce((sum, s) => sum + amountOf(s), 0) })).filter(x => x.value > 0)
  }, [approvedSales])
  const sourceTotal = sources.reduce((sum, x) => sum + x.value, 0)
  const firstSource = sources[0]
  const sourcePercent = firstSource && sourceTotal ? firstSource.value / sourceTotal * 100 : 0

  const selectPreset = (preset: 'today' | 'yesterday' | '7' | '30' | '90') => {
    const next = preset === 'today' ? { start: now, end: now } : preset === 'yesterday' ? { start: addDays(now, -1), end: addDays(now, -1) } : { start: addDays(now, -(Number(preset) - 1)), end: now }
    setRange(next); setDraft(next); setPeriodOpen(false); setCustomOpen(false)
  }
  const go = (page: string) => { setActive(page); window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: page })) }
  const daysSelected = Math.max(1, Math.floor((parse(range.end).getTime() - parse(range.start).getTime()) / 86400000) + 1)
  const calendarDays = calendar(month)
  const monthLabel = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const minMonth = parse(minDate)
  const maxMonth = parse(now)
  const canPrev = month.getFullYear() > minMonth.getFullYear() || month.getMonth() > minMonth.getMonth()
  const canNext = month.getFullYear() < maxMonth.getFullYear() || month.getMonth() < maxMonth.getMonth()

  if (active !== 'dashboard') return null

  return <section className="althea-mobile-dashboard" aria-label="Dashboard mobile">
    <header className="amd-header"><button type="button" className="amd-brand" aria-label="Voltar ao Dashboard" onClick={() => go('dashboard')}><img src="/althea-logo.png" alt="ALTHEA PAY" /></button><button className="amd-icon-button" type="button" aria-label="Sincronizar agora" onClick={() => void load()}><RefreshCw size={18} /></button></header>

    <div className="amd-heading"><span className="amd-eyebrow">CONTROL PLANE</span><h1>Dashboard</h1><p>Visão geral do seu negócio</p></div>

    <div className="amd-period-wrap"><button className="amd-period" type="button" onClick={() => setPeriodOpen(v => !v)} aria-expanded={periodOpen}><span className="amd-period-copy"><CalendarDays size={14} /><span>{range.start === range.end ? fmt(range.start) : `${fmt(range.start)} — ${fmt(range.end)}`}</span></span><span>⌄</span></button>{periodOpen && <div className="amd-period-menu"><button type="button" onClick={() => selectPreset('today')}>Hoje</button><button type="button" onClick={() => selectPreset('yesterday')}>Ontem</button><button type="button" onClick={() => selectPreset('7')}>Últimos 7 dias</button><button type="button" onClick={() => selectPreset('30')}>Últimos 30 dias</button><button type="button" onClick={() => selectPreset('90')}>Últimos 90 dias</button><button type="button" className="amd-period-custom" onClick={() => { setDraft(range); setMonth(parse(range.start)); setPeriodOpen(false); setCustomOpen(true) }}>Personalizado <span>›</span></button></div>}</div>
    <div className="amd-filter-caption"><span>{daysSelected} {daysSelected === 1 ? 'dia selecionado' : 'dias selecionados'}</span><button type="button" onClick={() => selectPreset('today')}>Hoje</button></div>

    {error && <div className="amd-card amd-error-card"><strong>Sincronização interrompida</strong><p>{error}</p><button className="amd-secondary-button" type="button" onClick={() => void load()}>Tentar novamente</button></div>}

    <div className="amd-kpis">{metrics.map((metric, index) => <article className={`amd-card amd-kpi ${loading ? 'amd-loading' : ''}`} key={metric.label}><div className="amd-kpi-head"><span>{metric.label}</span><span className="amd-kpi-arrow" aria-hidden="true">»</span></div>{loading ? <div className="amd-skeleton-line" /> : <strong>{metric.value}</strong>}<small>{index === 0 ? 'Volume aprovado' : index === 1 ? 'Todas as transações' : index === 2 ? 'Vendas aprovadas' : 'Identificados nas vendas'}</small></article>)}</div>

    <article className="amd-card amd-chart-card"><div className="amd-card-heading"><div><span className="amd-label">Receita ao longo do tempo</span><strong>{loading ? '—' : money(gross)}</strong></div><BarChart3 size={17} /></div>{series.some(x => x.value > 0) ? <><svg className="amd-chart" viewBox="0 0 300 120" preserveAspectRatio="none" aria-label="Receita ao longo do tempo"><path className="amd-chart-grid" d="M8 30H292 M8 60H292 M8 90H292" /><polyline className="amd-chart-line" points={points} fill="none" /></svg><div className="amd-chart-axis"><span>{fmt(range.start)}</span><span>{fmt(range.end)}</span></div></> : <div className="amd-chart-state"><BarChart3 size={20} /><span>{loading ? 'Sincronizando dados…' : 'Sem receita aprovada no período selecionado.'}</span></div>}</article>

    <article className="amd-card amd-revenue-card"><div className="amd-section-title"><span>Fontes de Receita</span><small>Distribuição por método</small></div>{sources.length ? <div className="amd-source-layout"><div className="amd-donut" style={{ background: `conic-gradient(#1DB854 0 ${sourcePercent}%, #26352E ${sourcePercent}% 100%)` }}><span>{Math.round(sourcePercent)}%</span><small>{firstSource?.label}</small></div><div className="amd-source-list">{sources.map((source, index) => <div key={source.label}><i className={`source-${index}`} /><span>{source.label}</span><b>{(source.value / sourceTotal * 100).toFixed(1)}%</b></div>)}</div></div> : <div className="amd-source-empty"><div className="amd-donut"><span>0%</span><small>Total</small></div><p>A distribuição aparecerá quando houver transações aprovadas reais.</p></div>}</article>

    <article className="amd-card amd-empty-card"><div className="amd-section-title"><span>Transações Recentes</span><small>Últimas vendas do período</small></div>{periodSales.length ? <div className="amd-recent-list">{periodSales.slice(0, 5).map(s => <button className="amd-recent-row" type="button" key={s.id} onClick={() => go('vendas')}><span><b>{String(s.data?.customer?.name || s.data?.customer?.email || s.id).slice(0, 24)}</b><small>{fmt(dateOf(s))} · {s.gateway_id || 'Gateway não identificado'}</small></span><strong>{money(amountOf(s))}</strong></button>)}</div> : <div className="amd-empty-state"><div className="amd-empty-icon"><CreditCard size={21} /></div><strong>Nenhuma transação encontrada</strong><p>As transações do período selecionado aparecerão aqui quando houver dados reais.</p><button type="button" className="amd-secondary-button" onClick={() => go('vendas')}>Ir para Vendas</button></div>}</article>

    <article className="amd-card amd-gateway-card"><div className="amd-section-title"><span>Status dos Gateways</span><small>Saúde da infraestrutura</small></div>{gateways.length ? <div className="amd-gateway-list">{gateways.map(g => <div className="amd-gateway-row" key={g.id}><span><b>{String(g.data?.name || g.data?.provider || g.id)}</b><small>Conectado</small></span><i className="unknown" /></div>)}</div> : <div className="amd-gateway-empty"><Network size={18} /><strong>Nenhum gateway conectado</strong><p>Conecte um gateway para acompanhar disponibilidade e processamento.</p><button type="button" className="amd-secondary-button" onClick={() => go('gateways')}>Configurar gateway</button></div>}</article>

    <nav className="amd-bottom-nav" aria-label="Navegação principal">{[[LayoutDashboard, 'Dashboard', 'dashboard'], [CreditCard, 'Vendas', 'vendas'], [Network, 'Funis', 'funis'], [Network, 'Gateway', 'gateways'], [Settings, 'Configuração', 'configuracoes']].map(([Icon, label, page]) => <button key={page as string} type="button" className={page === active ? 'active' : ''} onClick={() => go(page as string)}><Icon size={18} /><span>{label as string}</span></button>)}</nav>

    {customOpen && <div className="amd-calendar-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCustomOpen(false) }}><div className="amd-calendar-sheet" role="dialog" aria-modal="true" aria-label="Selecionar período"><div className="amd-calendar-head"><div><span className="amd-eyebrow">PERÍODO</span><strong>Selecionar datas</strong><small>Disponível nos últimos 90 dias</small></div><button type="button" aria-label="Fechar" onClick={() => setCustomOpen(false)}><X size={18} /></button></div><div className="amd-calendar-range"><div><span>De</span><b>{fmt(draft.start)}</b></div><div><span>Até</span><b>{fmt(draft.end)}</b></div></div><div className="amd-calendar-nav"><button type="button" disabled={!canPrev} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><strong>{monthLabel}</strong><button type="button" disabled={!canNext} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={17} /></button></div><div className="amd-weekdays">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}</div><div className="amd-calendar-grid">{calendarDays.map(day => { const disabled = day.value < minDate || day.value > now; const selected = day.value >= draft.start && day.value <= draft.end; const edge = day.value === draft.start || day.value === draft.end; return <button key={day.value} type="button" disabled={disabled} className={`${day.current ? '' : 'outside'} ${selected ? 'selected' : ''} ${edge ? 'edge' : ''}`} onClick={() => { if (draft.start === draft.end || day.value < draft.start) setDraft({ start: day.value, end: day.value }); else setDraft({ start: draft.start, end: day.value }) }}>{day.day}</button> })}</div><div className="amd-calendar-footer"><button type="button" className="amd-calendar-clear" onClick={() => setDraft({ start: now, end: now })}>Hoje</button><button type="button" className="amd-calendar-apply" onClick={() => { if (draft.start <= draft.end) { setRange(draft); setCustomOpen(false) } }}>Aplicar período</button></div></div></div>}
  </section>
}
