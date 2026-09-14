'use client'

import { CalendarDays, CheckCircle2, CreditCard, Filter, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { amountOf, dateOf, normalizeStatus, todayInSaoPaulo, type AnalyticsSale } from '@/lib/analytics/sales'

type Sale = AnalyticsSale & { currency?: string | null }
type JsonObject = Record<string, unknown>
const obj = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value)
const fmtMoney = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
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

  const loadSales = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: { user }, error: authError } = await db.auth.getUser()
    if (authError || !user) { setError('Sessão expirada. Entre novamente.'); setLoading(false); return }
    const { data, error: queryError } = await db.from('sales').select('*').eq('user_id', user.id).gte('created_at', `${startDate}T00:00:00-03:00`).lte('created_at', `${endDate}T23:59:59.999-03:00`).order('created_at', { ascending: false })
    if (queryError) { setError('Não foi possível carregar as vendas.'); setSales([]); setLoading(false); return }
    setSales((data ?? []) as Sale[])
    setLoading(false)
  }, [db, startDate, endDate])

  useEffect(() => { void loadSales() }, [loadSales])

  useEffect(() => {
    let userId: string | null = null
    let channel: ReturnType<typeof db.channel> | null = null
    void db.auth.getUser().then(({ data }) => {
      userId = data.user?.id ?? null
      if (!userId) return
      channel = db.channel(`sales-live-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `user_id=eq.${userId}` }, () => { void loadSales() }).subscribe()
    })
    return () => { if (channel) void db.removeChannel(channel) }
  }, [db, loadSales])

  const filtered = useMemo(() => sales.filter((sale) => {
    const value = obj(sale)
    const haystack = [value.id, value.customer_name, value.customer_email, value.product_name, value.status].map(text).join(' ').toLowerCase()
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase())
    const normalized = normalizeStatus(text(value.status))
    const matchesStatus = status === 'Todas' || (status === 'Aprovadas' && normalized === 'approved') || (status === 'Pendentes' && normalized === 'pending') || (status === 'Canceladas' && ['failed', 'cancelled'].includes(normalized))
    return matchesQuery && matchesStatus
  }), [sales, query, status])

  const applyPeriod = () => {
    if (!draftDateRangeValid) return
    setStartDate(draftStartDate); setEndDate(draftEndDate); setStatus(draftStatus); setPeriodOpen(false); setFilterOpen(false)
  }
  const clearFilters = () => { setQuery(''); setStatus('Todas'); setDraftStatus('Todas'); setStartDate(today); setEndDate(today); setDraftStartDate(today); setDraftEndDate(today); setFilterOpen(false); setPeriodOpen(false) }
  const openPeriod = () => { setDraftStartDate(startDate); setDraftEndDate(endDate); setPeriodOpen(true) }

  return null
}
