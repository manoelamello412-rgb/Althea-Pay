'use client'

import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, CreditCard, GitBranch, LayoutDashboard, MoreHorizontal, Network, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type Range = { start: string; end: string }
type Metric = { label: string; value: string; note: string }

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parse = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (value: string, amount: number) => { const d = parse(value); d.setDate(d.getDate() + amount); return iso(d) }
const formatDate = (value: string) => parse(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
const today = iso(new Date())
const minDate = addDays(today, -89)

function buildCalendar(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => { const d = new Date(start.getTime() + index * DAY_MS); return { value: iso(d), day: d.getDate(), current: d.getMonth() === month.getMonth() } })
}

export default function DashboardMobile() {
  const [active, setActive] = useState('dashboard')
  const [range, setRange] = useState<Range>({ start: today, end: today })
  const [draftRange, setDraftRange] = useState<Range>({ start: today, end: today })
  const [periodOpen, setPeriodOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(parse(today))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handler = (event: Event) => setActive((event as CustomEvent<string>).detail || 'dashboard')
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  const selectedLabel = useMemo(() => range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} — ${formatDate(range.end)}`, [range])
  const daysSelected = Math.floor((parse(range.end).getTime() - parse(range.start).getTime()) / DAY_MS) + 1
  const metrics: Metric[] = [
    { label: 'Receita Bruta', value: money(0), note: 'Sem dados no período' },
    { label: 'Faturamento Líquido', value: money(0), note: 'Sem dados no período' },
    { label: 'Taxas Acumuladas', value: money(0), note: 'Sem taxas registradas' },
    { label: 'Taxa de Aprovação', value: '0,0%', note: 'Sem transações' },
    { label: 'Ticket Médio', value: money(0), note: 'Sem vendas aprovadas' },
    { label: 'Reembolsos', value: money(0), note: 'Sem reembolsos' },
    { label: 'Chargebacks', value: '0', note: 'Sem ocorrências' },
    { label: 'Pagamentos Pendentes', value: '0', note: 'Sem pagamentos pendentes' },
  ]

  const applyPreset = (preset: 'today' | 'yesterday' | '7' | '30' | '90') => {
    const next: Range = preset === 'today'
      ? { start: today, end: today }
      : preset === 'yesterday'
        ? { start: addDays(today, -1), end: addDays(today, -1) }
        : { start: addDays(today, -(Number(preset) - 1)), end: today }
    setRange(next)
    setDraftRange(next)
    setPeriodOpen(false)
    setCustomOpen(false)
  }

  const openCustom = () => {
    setDraftRange(range)
    setCalendarMonth(parse(range.start))
    setPeriodOpen(false)
    setCustomOpen(true)
  }

  const selectDay = (value: string) => {
    if (value < minDate || value > today) return
    if (draftRange.start === draftRange.end || value < draftRange.start) {
      setDraftRange({ start: value, end: value })
      return
    }
    setDraftRange({ start: draftRange.start, end: value })
  }

  const applyCustom = () => {
    if (draftRange.start > draftRange.end) return
    setLoading(true)
    window.setTimeout(() => { setRange(draftRange); setLoading(false); setCustomOpen(false) }, 180)
  }

  const go = (page: string) => {
    setActive(page)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: page }))
  }

  if (active !== 'dashboard') return null

  const calendarDays = buildCalendar(calendarMonth)
  const monthLabel = calendarMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const minMonth = parse(minDate)
  const maxMonth = parse(today)
  const canPrevMonth = calendarMonth.getFullYear() > minMonth.getFullYear() || calendarMonth.getMonth() > minMonth.getMonth()
  const canNextMonth = calendarMonth.getFullYear() < maxMonth.getFullYear() || calendarMonth.getMonth() < maxMonth.getMonth()

  return <section className="althea-mobile-dashboard" aria-label="Dashboard mobile">
    <header className="amd-header"><div className="amd-brand"><img src="/althea-logo.png" alt="Althea Pay" /></div><button className="amd-icon-button" aria-label="Mais opções" type="button"><MoreHorizontal size={19} /></button></header>

    <div className="amd-heading"><span className="amd-eyebrow">CONTROL PLANE</span><h1>Dashboard</h1><p>Visão geral do seu negócio</p></div>

    <div className="amd-period-wrap">
      <button className="amd-period" type="button" onClick={() => setPeriodOpen(value => !value)} aria-expanded={periodOpen}><span className="amd-period-copy"><CalendarDays size={14} /><span>{selectedLabel}</span></span><span aria-hidden="true">⌄</span></button>
      {periodOpen && <div className="amd-period-menu" role="menu">
        <button type="button" onClick={() => applyPreset('today')}>Hoje</button>
        <button type="button" onClick={() => applyPreset('yesterday')}>Ontem</button>
        <button type="button" onClick={() => applyPreset('7')}>Últimos 7 dias</button>
        <button type="button" onClick={() => applyPreset('30')}>Últimos 30 dias</button>
        <button type="button" onClick={() => applyPreset('90')}>Últimos 90 dias</button>
        <button type="button" className="amd-period-custom" onClick={openCustom}>Personalizado <span>›</span></button>
      </div>}
    </div>

    <div className="amd-filter-caption"><span>{daysSelected} {daysSelected === 1 ? 'dia selecionado' : 'dias selecionados'}</span><button type="button" onClick={() => applyPreset('today')}>Hoje</button></div>

    <div className="amd-kpis">{metrics.map(metric => <article className={`amd-card amd-kpi ${loading ? 'amd-loading' : ''}`} key={metric.label}><span>{metric.label}</span>{loading ? <div className="amd-skeleton-line" /> : <strong>{metric.value}</strong>}<small>{metric.note}</small></article>)}</div>

    <article className="amd-card amd-chart-card"><div className="amd-card-heading"><div><span className="amd-label">Receita ao longo do tempo</span><strong>{loading ? '—' : money(0)}</strong></div><BarChart3 size={17} /></div><div className="amd-chart-state"><svg className="amd-chart" viewBox="0 0 252 104" role="img" aria-label="Receita ao longo do tempo" preserveAspectRatio="none"><path className="amd-chart-grid" d="M8 18H244 M8 44H244 M8 70H244 M8 96H244" /></svg><span>{loading ? 'Atualizando período…' : 'Sem dados no período selecionado'}</span></div><div className="amd-chart-axis"><span>{formatDate(range.start)}</span><span>{formatDate(range.end)}</span></div></article>

    <article className="amd-card amd-revenue-card"><div className="amd-section-title"><span>Fontes de Receita</span><small>Distribuição</small></div><div className="amd-source-layout"><div className="amd-donut"><span>0%</span><small>Total</small></div><div className="amd-source-list">{['Cartão', 'Pix', 'Boleto', 'Outros'].map(name => <div key={name}><i /><span>{name}</span><b>0%</b></div>)}</div></div><p className="amd-data-note">A distribuição aparecerá quando houver transações reais.</p></article>

    <article className="amd-card amd-empty-card"><div className="amd-section-title"><span>Transações Recentes</span><small>Últimas vendas</small></div><div className="amd-empty-icon"><CreditCard size={21} /></div><strong>Nenhuma transação encontrada</strong><p>As transações do período selecionado aparecerão aqui quando houver dados.</p><button type="button" className="amd-secondary-button" onClick={() => go('vendas')}>Ir para Vendas</button></article>

    <article className="amd-card amd-gateway-card"><div className="amd-section-title"><span>Status dos Gateways</span><small>Infraestrutura</small></div><div className="amd-gateway-empty"><Network size={18} /><strong>Nenhum gateway conectado</strong><p>Conecte um gateway para acompanhar disponibilidade, saúde e processamento.</p><button type="button" className="amd-secondary-button" onClick={() => go('gateways')}>Configurar gateway</button></div></article>

    <nav className="amd-bottom-nav" aria-label="Navegação principal">{[['Dashboard', LayoutDashboard, 'dashboard'], ['Vendas', CreditCard, 'vendas'], ['Funis', GitBranch, 'funis'], ['Gateway', Network, 'gateways'], ['Configuração', Settings, 'configuracoes']].map(([label, Icon, page]) => <button key={page as string} type="button" className={page === active ? 'active' : ''} onClick={() => go(page as string)}><Icon size={18} /><span>{label as string}</span></button>)}</nav>

    {customOpen && <div className="amd-calendar-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCustomOpen(false) }}><div className="amd-calendar-sheet" role="dialog" aria-modal="true" aria-label="Selecionar período">
      <div className="amd-calendar-head"><div><span className="amd-eyebrow">PERÍODO</span><strong>Selecionar datas</strong><small>Disponível nos últimos 90 dias</small></div><button type="button" aria-label="Fechar" onClick={() => setCustomOpen(false)}><X size={18} /></button></div>
      <div className="amd-calendar-range"><div><span>De</span><b>{formatDate(draftRange.start)}</b></div><div><span>Até</span><b>{formatDate(draftRange.end)}</b></div></div>
      <div className="amd-calendar-nav"><button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} disabled={!canPrevMonth}><ChevronLeft size={17} /></button><strong>{monthLabel}</strong><button type="button" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} disabled={!canNextMonth}><ChevronRight size={17} /></button></div>
      <div className="amd-weekdays">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="amd-calendar-grid">{calendarDays.map(day => { const disabled = day.value < minDate || day.value > today; const selected = day.value >= draftRange.start && day.value <= draftRange.end; const edge = day.value === draftRange.start || day.value === draftRange.end; return <button key={day.value} type="button" disabled={disabled} className={`${day.current ? '' : 'outside'} ${selected ? 'selected' : ''} ${edge ? 'edge' : ''}`} onClick={() => selectDay(day.value)}>{day.day}</button> })}</div>
      <div className="amd-calendar-footer"><button type="button" className="amd-calendar-clear" onClick={() => setDraftRange({ start: today, end: today })}>Hoje</button><button type="button" className="amd-calendar-apply" onClick={applyCustom}>Aplicar período</button></div>
    </div></div>}
  </section>
}
