'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'
export type DateRangeValue = { from: Date; to: Date }
type Props = { value?: DateRangeValue; onChange?: (range: DateRangeValue) => void; className?: string }

type CalendarCell = { date: Date; inMonth: boolean }

function startOfDay(date: Date): Date { const next = new Date(date); next.setHours(0, 0, 0, 0); return next }
function endOfDay(date: Date): Date { const next = new Date(date); next.setHours(23, 59, 59, 999); return next }
function toDateInput(date: Date): string { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}` }
function fromDateInput(value: string): Date { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day) }
function sameDay(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function isBetween(date: Date, range: DateRangeValue): boolean { return date.getTime() >= startOfDay(range.from).getTime() && date.getTime() <= endOfDay(range.to).getTime() }
function monthCells(month: Date): CalendarCell[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const firstGrid = new Date(first)
  firstGrid.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(firstGrid); date.setDate(firstGrid.getDate() + index); return { date, inMonth: date.getMonth() === month.getMonth() } })
}
function presetRange(preset: Exclude<Preset, 'custom'>, now = new Date()): DateRangeValue {
  const today = startOfDay(now)
  if (preset === 'today') return { from: today, to: endOfDay(today) }
  if (preset === 'yesterday') { const from = new Date(today); from.setDate(from.getDate() - 1); return { from, to: endOfDay(from) } }
  if (preset === '7d') { const from = new Date(today); from.setDate(from.getDate() - 6); return { from, to: endOfDay(today) } }
  if (preset === '30d') { const from = new Date(today); from.setDate(from.getDate() - 29); return { from, to: endOfDay(today) } }
  return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: endOfDay(today) }
}

export default function DateRangePicker({ value, onChange, className = '' }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const initial = value ?? presetRange('7d')
  const [range, setRange] = useState<DateRangeValue>(initial)
  const [preset, setPreset] = useState<Preset>('7d')
  const [open, setOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(new Date(initial.from.getFullYear(), initial.from.getMonth(), 1))
  const [selectingEnd, setSelectingEnd] = useState(false)
  const [liveVersion, setLiveVersion] = useState(0)

  const syncRange = useCallback(async (next: DateRangeValue): Promise<void> => {
    const normalized: DateRangeValue = next.from.getTime() <= next.to.getTime() ? next : { from: next.to, to: next.from }
    setRange(normalized)
    onChange?.(normalized)
    const params = new URLSearchParams(window.location.search)
    params.set('from', toDateInput(normalized.from))
    params.set('to', toDateInput(normalized.to))
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
    setPreset('custom')
  }, [onChange])

  useEffect(() => {
    let cancelled = false
    async function hydrateFromUrl(): Promise<void> {
      const params = new URLSearchParams(window.location.search)
      const from = params.get('from')
      const to = params.get('to')
      if (!from || !to) return
      const parsed: DateRangeValue = { from: startOfDay(fromDateInput(from)), to: endOfDay(fromDateInput(to)) }
      if (!cancelled) setRange(parsed)
    }
    void hydrateFromUrl()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null
    async function subscribe(): Promise<void> {
      const { data: auth } = await supabase.auth.getUser()
      if (cancelled || !auth.user) return
      channel = supabase.channel(`routing-logs-${auth.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_routing_logs', filter: `user_id=eq.${auth.user.id}` }, () => { if (!cancelled) setLiveVersion((version) => version + 1) })
        .subscribe()
    }
    void subscribe()
    return () => { cancelled = true; if (channel) void supabase.removeChannel(channel) }
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    async function fetchFilteredLogs(): Promise<void> {
      const params = new URLSearchParams(window.location.search)
      const from = params.get('from') ?? toDateInput(range.from)
      const to = params.get('to') ?? toDateInput(range.to)
      const { data: auth } = await supabase.auth.getUser()
      if (cancelled || !auth.user) return
      const result = await supabase.from('transaction_routing_logs').select('id,status,final_gateway,created_at').eq('user_id', auth.user.id).gte('created_at', `${from}T00:00:00.000Z`).lte('created_at', `${to}T23:59:59.999Z`).order('created_at', { ascending: false }).limit(250)
      if (cancelled || result.error) return
      window.dispatchEvent(new CustomEvent('althea:routing-logs-updated', { detail: { logs: result.data ?? [], from, to, liveVersion } }))
    }
    void fetchFilteredLogs()
    return () => { cancelled = true }
  }, [liveVersion, range.from, range.to, supabase])

  function choosePreset(nextPreset: Exclude<Preset, 'custom'>): void {
    const next = presetRange(nextPreset)
    void syncRange(next)
    setPreset(nextPreset)
    setCalendarMonth(new Date(next.from.getFullYear(), next.from.getMonth(), 1))
    setOpen(false)
  }

  function selectCalendarDate(date: Date): void {
    const day = startOfDay(date)
    if (!selectingEnd) { setRange({ from: day, to: day }); setSelectingEnd(true); setPreset('custom'); return }
    const next = day.getTime() < range.from.getTime() ? { from: day, to: range.from } : { from: range.from, to: day }
    setSelectingEnd(false)
    void syncRange({ from: startOfDay(next.from), to: endOfDay(next.to) })
  }

  const cells = useMemo(() => monthCells(calendarMonth), [calendarMonth])
  const label = `${range.from.toLocaleDateString('pt-BR')} — ${range.to.toLocaleDateString('pt-BR')}`

  return <div className={`date-range-picker ${className}`}>
    <button className="date-range-trigger" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}><CalendarDays size={17} /><span>{label}</span><small>{preset === 'custom' ? 'Personalizado' : preset === 'today' ? 'Hoje' : preset === 'yesterday' ? 'Ontem' : preset === '7d' ? 'Últimos 7 dias' : preset === '30d' ? 'Últimos 30 dias' : 'Mês corrente'}</small></button>
    {open && <div className="date-range-popover">
      <div className="date-range-presets">{([['today', 'Hoje'], ['yesterday', 'Ontem'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['month', 'Mês corrente']] as const).map(([key, text]) => <button key={key} className={preset === key ? 'selected' : ''} type="button" onClick={() => choosePreset(key)}>{text}</button>)}<button className={preset === 'custom' ? 'selected' : ''} type="button" onClick={() => { setPreset('custom'); setSelectingEnd(false) }}>Customizado</button></div>
      <div className="date-range-calendar">
        <div className="date-range-calendar-header"><button type="button" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior"><ChevronLeft size={18} /></button><strong>{calendarMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong><button type="button" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Próximo mês"><ChevronRight size={18} /></button></div>
        <div className="date-range-weekdays">{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
        <div className="date-range-grid">{cells.map(({ date, inMonth }) => <button key={date.toISOString()} type="button" className={`${inMonth ? '' : 'muted'} ${sameDay(date, range.from) || sameDay(date, range.to) ? 'endpoint' : ''} ${isBetween(date, range) ? 'in-range' : ''}`} onClick={() => selectCalendarDate(date)}>{date.getDate()}</button>)}</div>
        <div className="date-range-custom-row"><label>Início<input type="date" value={toDateInput(range.from)} onChange={(event) => void syncRange({ from: startOfDay(fromDateInput(event.target.value)), to: range.to })} /></label><label>Fim<input type="date" value={toDateInput(range.to)} onChange={(event) => void syncRange({ from: range.from, to: endOfDay(fromDateInput(event.target.value)) })} /></label></div>
        <div className="date-range-footer"><span><i /> Realtime ativo · {liveVersion}</span><button type="button" onClick={() => { setRange(presetRange('7d')); setPreset('7d'); setSelectingEnd(false); window.history.replaceState(null, '', window.location.pathname); window.dispatchEvent(new CustomEvent('althea:routing-logs-updated', { detail: { reset: true } })) }}><RotateCcw size={14} />Resetar</button></div>
      </div>
    </div>}
  </div>
}
