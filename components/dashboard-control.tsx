'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Network,
  RefreshCw,
  X,
} from 'lucide-react'

interface DashboardControlProps {
  dbClient: any
  userId: string
}

type Range = { start: string; end: string }
type Sale = {
  id: string
  amount: number | string | null
  currency?: string | null
  status?: string | null
  data?: Record<string, any> | null
  attribution?: Record<string, any> | null
  source?: string | null
  medium?: string | null
  campaign?: string | null
  gateway_id?: string | null
  occurred_at?: string | null
  created_at?: string | null
}
type Gateway = {
  id: string
  data?: Record<string, any> | null
}
type Dispute = {
  id: string
  amount?: number | string | null
  status?: string | null
  created_at?: string | null
}
type DayPoint = { date: string; value: number }

const TZ = 'America/Sao_Paulo'
const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

function localISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(value: string, amount: number) {
  const date = parseDate(value)
  date.setDate(date.getDate() + amount)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDate(value: string) {
  return parseDate(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function startOfDayUTC(value: string) {
  return `${value}T00:00:00.000-03:00`
}

function endOfDayUTC(value: string) {
  return `${value}T23:59:59.999-03:00`
}

function isApproved(status?: string | null) {
  return status === 'approved' || status === 'completed'
}

function isPending(status?: string | null) {
  return status === 'pending' || status === 'processing' || status === 'created'
}

function isRefunded(status?: string | null) {
  return status === 'refunded'
}

function isFailed(status?: string | null) {
  return status === 'failed' || status === 'declined' || status === 'cancelled'
}

function getPaymentMethod(sale: Sale) {
  const data = sale.data ?? {}
  const candidates = [
    data.payment_method,
    data.paymentMethod,
    data.method,
    data.payment?.method,
    data.payment?.payment_method,
  ]
  const value = candidates.find((item) => typeof item === 'string' && item.trim())
  return typeof value === 'string' ? value.toLowerCase() : 'outros'
}

function getFee(sale: Sale, defaultFee: number) {
  const data = sale.data ?? {}
  const candidates = [
    data.fee_amount,
    data.feeAmount,
    data.fee,
    data.fees,
  ]
  const explicit = candidates.find((item) => item !== null && item !== undefined && item !== '')
  if (explicit !== undefined) return Math.max(0, Number(explicit) || 0)
  return Math.max(0, Number(defaultFee) || 0)
}

function buildCalendar(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const firstDay = first.getDay()
  const start = new Date(first)
  start.setDate(first.getDate() - firstDay)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      value: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      day: date.getDate(),
      current: date.getMonth() === month.getMonth(),
    }
  })
}

function buildDaySeries(start: string, end: string, sales: Sale[]): DayPoint[] {
  const approvedByDay = new Map<string, number>()
  sales.forEach((sale) => {
    if (!isApproved(sale.status)) return
    const timestamp = sale.occurred_at ?? sale.created_at
    if (!timestamp) return
    const key = localISO(new Date(timestamp))
    approvedByDay.set(key, (approvedByDay.get(key) ?? 0) + Number(sale.amount || 0))
  })

  const points: DayPoint[] = []
  let cursor = start
  while (cursor <= end) {
    points.push({ date: cursor, value: approvedByDay.get(cursor) ?? 0 })
    cursor = addDays(cursor, 1)
  }
  return points
}

export default function DashboardControl({ dbClient, userId }: DashboardControlProps) {
  const today = localISO()
  const minDate = addDays(today, -89)

  const [range, setRange] = useState<Range>({ start: today, end: today })
  const [draftRange, setDraftRange] = useState<Range>({ start: today, end: today })
  const [periodOpen, setPeriodOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(parseDate(today))
  const [sales, setSales] = useState<Sale[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [defaultFee, setDefaultFee] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const fetchDashboard = useCallback(async () => {
    if (!dbClient || !userId) return

    setLoading(true)
    setError(null)

    try {
      const [salesResult, disputesResult, gatewaysResult, settingsResult] = await Promise.all([
        dbClient
          .from('sales')
          .select('id, amount, currency, status, data, attribution, source, medium, campaign, gateway_id, occurred_at, created_at')
          .eq('user_id', userId)
          .gte('occurred_at', startOfDayUTC(range.start))
          .lte('occurred_at', endOfDayUTC(range.end))
          .order('occurred_at', { ascending: false }),
        dbClient
          .from('disputes')
          .select('id, amount, status, created_at')
          .eq('user_id', userId)
          .gte('created_at', startOfDayUTC(range.start))
          .lte('created_at', endOfDayUTC(range.end))
          .order('created_at', { ascending: false }),
        dbClient
          .from('gateways')
          .select('id, data')
          .eq('user_id', userId),
        dbClient
          .from('frontend_settings')
          .select('default_fee, base_currency, timezone')
          .eq('user_id', userId)
          .maybeSingle(),
      ])

      if (salesResult.error) throw salesResult.error
      if (disputesResult.error) throw disputesResult.error
      if (gatewaysResult.error) throw gatewaysResult.error
      if (settingsResult.error) throw settingsResult.error

      setSales((salesResult.data ?? []) as Sale[])
      setDisputes((disputesResult.data ?? []) as Dispute[])
      setGateways((gatewaysResult.data ?? []) as Gateway[])
      setDefaultFee(Number(settingsResult.data?.default_fee ?? 0))
      setLastSync(new Date())
    } catch (cause: any) {
      console.error('[ALTHEA-DASHBOARD] Falha ao carregar dados:', cause)
      setError('Não foi possível carregar os dados do período.')
      setSales([])
      setDisputes([])
      setGateways([])
    } finally {
      setLoading(false)
    }
  }, [dbClient, userId, range.start, range.end])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  useEffect(() => {
    if (!dbClient || !userId) return

    const channel = dbClient
      .channel(`dashboard-control-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `user_id=eq.${userId}` }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes', filter: `user_id=eq.${userId}` }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gateways', filter: `user_id=eq.${userId}` }, fetchDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'frontend_settings', filter: `user_id=eq.${userId}` }, fetchDashboard)
      .subscribe()

    return () => {
      dbClient.removeChannel(channel)
    }
  }, [dbClient, userId, fetchDashboard])

  const metrics = useMemo(() => {
    let gross = 0
    let fees = 0
    let refunds = 0
    let approved = 0
    let pending = 0
    let failed = 0

    sales.forEach((sale) => {
      const amount = Number(sale.amount || 0)
      if (isApproved(sale.status)) {
        gross += amount
        fees += getFee(sale, defaultFee)
        approved += 1
      } else if (isRefunded(sale.status)) {
        refunds += amount
      } else if (isPending(sale.status)) {
        pending += 1
      } else if (isFailed(sale.status)) {
        failed += 1
      }
    })

    const total = sales.length
    const net = Math.max(0, gross - fees - refunds)
    const approvalRate = total ? (approved / total) * 100 : 0
    const ticket = approved ? gross / approved : 0

    return {
      gross,
      fees,
      refunds,
      approved,
      pending,
      failed,
      total,
      net,
      approvalRate,
      ticket,
      chargebacks: disputes.length,
      chargebackAmount: disputes.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    }
  }, [sales, disputes, defaultFee])

  const daySeries = useMemo(() => buildDaySeries(range.start, range.end, sales), [range, sales])
  const chartMax = Math.max(1, ...daySeries.map((point) => point.value))
  const selectedDays = daySeries.length

  const paymentMethods = useMemo(() => {
    const totals = new Map<string, number>()
    let total = 0
    sales.filter((sale) => isApproved(sale.status)).forEach((sale) => {
      const amount = Number(sale.amount || 0)
      const method = getPaymentMethod(sale)
      totals.set(method, (totals.get(method) ?? 0) + amount)
      total += amount
    })

    return ['pix', 'credit_card', 'boleto', 'debit_card', 'outros'].map((method) => ({
      method,
      value: totals.get(method) ?? 0,
      percent: total ? ((totals.get(method) ?? 0) / total) * 100 : 0,
    }))
  }, [sales])

  const applyPreset = (preset: 'today' | 'yesterday' | '7' | '30' | '90') => {
    const next = preset === 'today'
      ? { start: today, end: today }
      : preset === 'yesterday'
        ? { start: addDays(today, -1), end: addDays(today, -1) }
        : { start: addDays(today, -(Number(preset) - 1)), end: today }

    setRange(next)
    setDraftRange(next)
    setPeriodOpen(false)
    setCalendarOpen(false)
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
    setRange(draftRange)
    setCalendarOpen(false)
    setPeriodOpen(false)
  }

  const calendarDays = buildCalendar(calendarMonth)
  const minMonth = parseDate(minDate)
  const maxMonth = parseDate(today)
  const canPrevMonth = calendarMonth.getFullYear() > minMonth.getFullYear() || calendarMonth.getMonth() > minMonth.getMonth()
  const canNextMonth = calendarMonth.getFullYear() < maxMonth.getFullYear() || calendarMonth.getMonth() < maxMonth.getMonth()
  const selectedLabel = range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} — ${formatDate(range.end)}`

  const cardData = [
    ['Receita Bruta', money(metrics.gross), 'Volume aprovado'],
    ['Faturamento Líquido', money(metrics.net), 'Após taxas e reembolsos'],
    ['Taxas Acumuladas', money(metrics.fees), 'Taxas efetivamente registradas'],
    ['Taxa de Aprovação', `${metrics.approvalRate.toFixed(1)}%`, `${metrics.approved} aprovadas de ${metrics.total}`],
    ['Ticket Médio', money(metrics.ticket), 'Vendas aprovadas'],
    ['Reembolsos', money(metrics.refunds), 'Valor reembolsado'],
    ['Chargebacks', String(metrics.chargebacks), money(metrics.chargebackAmount)],
    ['Pagamentos Pendentes', String(metrics.pending), 'Aguardando conclusão'],
  ]

  return (
    <section className="space-y-6 animate-fade-in pb-32" aria-label="Controle do Dashboard">
      <div className="flex flex-col gap-4 border-b border-zinc-900/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1DB854]">CONTROL PLANE</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-xs text-zinc-500">Análise financeira e operação em tempo real</p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setPeriodOpen((open) => !open)}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-zinc-800/70 bg-[#0F1A16] px-3 text-xs text-zinc-200 transition-all duration-200 active:scale-[0.98]"
            aria-expanded={periodOpen}
          >
            <CalendarDays size={14} className="text-[#1DB854]" />
            <span>{selectedLabel}</span>
            <span className="text-zinc-600">⌄</span>
          </button>

          {periodOpen && (
            <div className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-xl border border-zinc-800 bg-[#0B0B0D] p-1 shadow-2xl">
              {[
                ['Hoje', 'today'],
                ['Ontem', 'yesterday'],
                ['Últimos 7 dias', '7'],
                ['Últimos 30 dias', '30'],
                ['Últimos 90 dias', '90'],
              ].map(([label, value]) => (
                <button key={value} type="button" onClick={() => applyPreset(value as any)} className="w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-xs text-zinc-300 transition-all duration-200 hover:bg-[#0F1A16] hover:text-white active:scale-[0.98]">
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => { setDraftRange(range); setCalendarMonth(parseDate(range.start)); setPeriodOpen(false); setCalendarOpen(true) }} className="w-full cursor-pointer rounded-lg border-t border-zinc-900 px-3 py-2.5 text-left text-xs text-[#1DB854] transition-all duration-200 hover:bg-[#0F1A16] active:scale-[0.98]">
                Personalizado <span className="float-right">›</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-900/40 bg-amber-950/10 px-4 py-3 text-xs text-amber-200">
          <span>{error}</span>
          <button type="button" onClick={fetchDashboard} className="cursor-pointer rounded-lg border border-amber-900/40 px-3 py-1.5 transition-all duration-200 active:scale-[0.98]">Tentar novamente</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cardData.map(([label, value, note]) => (
          <article key={label} className="relative overflow-hidden rounded-xl border border-zinc-800/60 bg-[#0F1A16] p-4">
            <span className="block truncate text-[11px] font-medium text-zinc-500">{label}</span>
            {loading ? <div className="mt-2 h-6 w-24 animate-pulse rounded bg-zinc-800" /> : <strong className="mt-2 block text-base font-bold tracking-tight text-white">{value}</strong>}
            <small className="mt-1 block truncate text-[10px] text-zinc-600">{note}</small>
          </article>
        ))}
      </div>

      <article className="rounded-xl border border-zinc-800/60 bg-[#0F1A16] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Receita ao longo do tempo</span>
            <strong className="mt-1 block text-lg text-white">{loading ? '—' : money(metrics.gross)}</strong>
          </div>
          <BarChart3 size={17} className="text-[#1DB854]" />
        </div>

        {loading ? (
          <div className="mt-5 h-48 animate-pulse rounded-lg bg-zinc-900/70" />
        ) : sales.length === 0 ? (
          <div className="mt-5 flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-900 text-center text-xs text-zinc-600">
            Nenhuma transação aprovada no período selecionado.
          </div>
        ) : (
          <div className="mt-5 h-48 rounded-lg border border-zinc-900 bg-black/10 p-3">
            <div className="flex h-full items-end gap-1">
              {daySeries.map((point) => (
                <div key={point.date} className="group flex h-full flex-1 items-end" title={`${formatDate(point.date)} · ${money(point.value)}`}>
                  <div className="w-full rounded-t bg-[#1DB854]/70 transition-all duration-300 group-hover:bg-[#1DB854]" style={{ height: `${Math.max(point.value ? 4 : 1, (point.value / chartMax) * 100)}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-between text-[10px] text-zinc-600">
          <span>{formatDate(range.start)}</span>
          <span>{selectedDays} {selectedDays === 1 ? 'dia' : 'dias'}</span>
          <span>{formatDate(range.end)}</span>
        </div>
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-zinc-800/60 bg-[#0F1A16] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Fontes de Receita</span>
            <small className="text-[10px] text-zinc-600">Aprovadas</small>
          </div>
          <div className="mt-5 space-y-3">
            {paymentMethods.map((item) => (
              <div key={item.method}>
                <div className="mb-1 flex justify-between text-[11px]">
                  <span className="text-zinc-400">{item.method === 'credit_card' ? 'Cartão' : item.method === 'debit_card' ? 'Débito' : item.method === 'pix' ? 'Pix' : item.method === 'boleto' ? 'Boleto' : 'Outros'}</span>
                  <span className="text-zinc-500">{item.percent.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
                  <div className="h-full rounded-full bg-[#1DB854] transition-all duration-500" style={{ width: `${Math.min(100, item.percent)}%` }} />
                </div>
              </div>
            ))}
          </div>
          {!sales.length && <p className="mt-4 text-[10px] text-zinc-600">A distribuição será calculada quando existirem transações reais.</p>}
        </article>

        <article className="rounded-xl border border-zinc-800/60 bg-[#0F1A16] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Status dos Gateways</span>
            <Network size={16} className="text-[#1DB854]" />
          </div>
          {gateways.length === 0 ? (
            <div className="mt-5 flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-900 px-5 text-center">
              <Network size={20} className="text-zinc-700" />
              <strong className="mt-2 text-xs text-zinc-400">Nenhum gateway conectado</strong>
              <p className="mt-1 text-[10px] text-zinc-600">A infraestrutura aparecerá aqui quando uma conexão real for configurada.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {gateways.slice(0, 5).map((gateway) => (
                <div key={gateway.id} className="flex items-center justify-between rounded-lg border border-zinc-900 bg-black/10 px-3 py-2.5">
                  <span className="font-mono text-[10px] text-zinc-500">{gateway.id}</span>
                  <span className="text-[10px] text-[#1DB854]">Conectado</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="flex items-center justify-between text-[10px] text-zinc-700">
        <span>{lastSync ? `Sincronizado às ${lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Sincronizando…'}</span>
        <span className="flex items-center gap-1.5"><RefreshCw size={11} className={loading ? 'animate-spin text-[#1DB854]' : 'text-zinc-700'} /> Realtime</span>
      </div>

      {calendarOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalendarOpen(false) }}>
          <div className="w-full max-w-md rounded-t-2xl border border-zinc-800 bg-[#0B0B0D] p-5 shadow-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1DB854]">PERÍODO</p>
                <h2 className="mt-1 text-base font-semibold text-white">Selecionar datas</h2>
                <p className="mt-1 text-[10px] text-zinc-600">Disponível nos últimos 90 dias</p>
              </div>
              <button type="button" aria-label="Fechar calendário" onClick={() => setCalendarOpen(false)} className="cursor-pointer rounded-lg p-2 text-zinc-500 transition-all duration-200 hover:bg-[#0F1A16] hover:text-white active:scale-[0.98]"><X size={17} /></button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-zinc-900 bg-[#0F1A16] p-3"><span className="block text-[9px] uppercase text-zinc-600">De</span><strong className="mt-1 block text-xs text-white">{formatDate(draftRange.start)}</strong></div>
              <div className="rounded-lg border border-zinc-900 bg-[#0F1A16] p-3"><span className="block text-[9px] uppercase text-zinc-600">Até</span><strong className="mt-1 block text-xs text-white">{formatDate(draftRange.end)}</strong></div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button type="button" disabled={!canPrevMonth} onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="cursor-pointer rounded-lg p-2 text-zinc-500 transition-all duration-200 hover:bg-[#0F1A16] disabled:cursor-not-allowed disabled:opacity-20 active:scale-[0.98]"><ChevronLeft size={17} /></button>
              <strong className="text-xs capitalize text-zinc-300">{calendarMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>
              <button type="button" disabled={!canNextMonth} onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="cursor-pointer rounded-lg p-2 text-zinc-500 transition-all duration-200 hover:bg-[#0F1A16] disabled:cursor-not-allowed disabled:opacity-20 active:scale-[0.98]"><ChevronRight size={17} /></button>
            </div>

            <div className="mt-3 grid grid-cols-7 text-center text-[9px] font-semibold text-zinc-700">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`} className="py-2">{day}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const disabled = day.value < minDate || day.value > today
                const selected = day.value >= draftRange.start && day.value <= draftRange.end
                const edge = day.value === draftRange.start || day.value === draftRange.end
                return (
                  <button key={day.value} type="button" disabled={disabled} onClick={() => selectDay(day.value)} className={`aspect-square cursor-pointer rounded-lg text-[11px] transition-all duration-200 active:scale-[0.96] ${!day.current ? 'text-zinc-800' : 'text-zinc-400'} ${selected ? 'bg-[#0D362D] text-[#1DB854]' : 'hover:bg-[#0F1A16]'} ${edge ? 'ring-1 ring-[#1DB854]/60' : ''} ${disabled ? 'cursor-not-allowed opacity-20' : ''}`}>{day.day}</button>
                )
              })}
            </div>

            <div className="mt-5 flex gap-2 border-t border-zinc-900 pt-4">
              <button type="button" onClick={() => { setDraftRange({ start: today, end: today }); setCalendarMonth(parseDate(today)) }} className="cursor-pointer rounded-xl border border-zinc-800 px-4 py-3 text-xs text-zinc-400 transition-all duration-200 hover:bg-[#0F1A16] active:scale-[0.98]">Hoje</button>
              <button type="button" disabled={draftRange.start > draftRange.end} onClick={applyCustom} className="flex-1 cursor-pointer rounded-xl bg-[#1DB854] px-4 py-3 text-xs font-semibold text-black transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 active:scale-[0.98]">Aplicar período</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
