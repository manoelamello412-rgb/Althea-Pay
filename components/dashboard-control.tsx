'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Clock3, Eye, EyeOff, Filter, RefreshCw, ShoppingCart, Ticket, Wallet } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Sale = { id: string; amount: number | string | null; status: string | null; customer_id: string | null; data: Record<string, unknown> | null; gateway_id: string | null; occurred_at: string | null; created_at: string | null }
type RangeDays = 7 | 30 | 90
const TIME_ZONE = 'America/Sao_Paulo'
const APPROVED = new Set(['approved', 'completed', 'paid', 'success', 'succeeded', 'authorized'])
const PENDING = new Set(['pending', 'processing', 'waiting', 'waiting_payment', 'in_review', 'in_analysis'])
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const parseDate = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d) }
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const addDays = (value: string, amount: number) => { const d = parseDate(value); d.setDate(d.getDate() + amount); return iso(d) }
const amountOf = (sale: Sale) => { const n = Number(sale.amount ?? sale.data?.amount ?? 0); return Number.isFinite(n) ? n : 0 }
const statusOf = (sale: Sale) => String(sale.status ?? '').trim().toLowerCase()
const approved = (sale: Sale) => APPROVED.has(statusOf(sale))
const pending = (sale: Sale) => PENDING.has(statusOf(sale))
const dateOf = (sale: Sale) => String(sale.occurred_at ?? sale.created_at ?? '').slice(0, 10)
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const customerName = (sale: Sale) => { const data = sale.data ?? {}; const customer = data.customer && typeof data.customer === 'object' ? data.customer as Record<string, unknown> : null; const name = data.customer_name ?? data.name ?? customer?.name ?? customer?.full_name; if (typeof name === 'string' && name.trim()) return name.trim(); const email = data.customer_email ?? data.email ?? customer?.email; if (typeof email === 'string' && email.trim()) return email.trim(); return sale.customer_id ? `Cliente ${sale.customer_id.slice(0, 6).toUpperCase()}` : 'Cliente' }

export default function DashboardControl() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [sales, setSales] = useState<Sale[]>([])
  const [operatorName, setOperatorName] = useState('Operador')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hideValues, setHideValues] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const range = useMemo(() => { const end = today(); return { start: addDays(end, -(rangeDays - 1)), end } }, [rangeDays])
  const previousRange = useMemo(() => ({ start: addDays(range.start, -rangeDays), end: addDays(range.start, -1) }), [range, rangeDays])

  const load = useCallback(async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const { data: auth, error: authError } = await db.auth.getUser()
      if (authError) throw authError
      if (!auth.user) { setSales([]); setOperatorName('Operador'); return }
      const metadata = auth.user.user_metadata as Record<string, unknown> | undefined
      const name = metadata?.full_name ?? metadata?.name ?? metadata?.display_name
      setOperatorName(typeof name === 'string' && name.trim() ? name.trim() : auth.user.email?.split('@')[0] ?? 'Operador')
      const since = addDays(today(), -179)
      const { data, error: queryError } = await db.from('sales').select('id,amount,status,customer_id,data,gateway_id,occurred_at,created_at').gte('created_at', `${since}T00:00:00-03:00`).order('created_at', { ascending: false }).limit(5000)
      if (queryError) throw queryError
      setSales((data ?? []) as Sale[])
      setLastUpdated(new Date())
    } catch (cause) {
      console.error('[ALTHEA-DASHBOARD]', cause)
      setError('Não foi possível sincronizar os dados agora.')
    } finally { silent ? setRefreshing(false) : setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => { const handler = () => void load(true); window.addEventListener('althea-refresh', handler); return () => window.removeEventListener('althea-refresh', handler) }, [load])
  useEffect(() => { let channel: ReturnType<typeof db.channel> | null = null; let cancelled = false; const subscribe = async () => { const { data: auth } = await db.auth.getUser(); if (cancelled || !auth.user) return; channel = db.channel(`althea-dashboard-sales-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => void load(true)).subscribe() }; void subscribe(); return () => { cancelled = true; if (channel) void db.removeChannel(channel) } }, [db, load])

  const periodSales = useMemo(() => sales.filter(s => dateOf(s) >= range.start && dateOf(s) <= range.end), [sales, range])
  const previousSales = useMemo(() => sales.filter(s => dateOf(s) >= previousRange.start && dateOf(s) <= previousRange.end), [sales, previousRange])
  const approvedSales = useMemo(() => periodSales.filter(approved), [periodSales])
  const pendingSales = useMemo(() => periodSales.filter(pending), [periodSales])
  const revenue = useMemo(() => approvedSales.reduce((sum, sale) => sum + amountOf(sale), 0), [approvedSales])
  const ticket = approvedSales.length ? revenue / approvedSales.length : 0
  const approvalRate = periodSales.length ? (approvedSales.length / periodSales.length) * 100 : 0
  const previousRevenue = useMemo(() => previousSales.filter(approved).reduce((sum, sale) => sum + amountOf(sale), 0), [previousSales])
  const revenueChange = previousRevenue === 0 ? (revenue > 0 ? 100 : 0) : ((revenue - previousRevenue) / previousRevenue) * 100
  const customers = useMemo(() => new Set(periodSales.map(s => s.customer_id).filter(Boolean)).size, [periodSales])
  const latestSales = periodSales.slice(0, 5)
  const updated = lastUpdated ? new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastUpdated) : 'Sincronizando…'
  const periodLabel = `${new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' }).format(parseDate(range.start))} — ${new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' }).format(parseDate(range.end))}`
  const trend = `${revenueChange >= 0 ? '↑' : '↓'} ${Math.abs(revenueChange).toFixed(1).replace('.', ',')}%`

  return <section className="w-full bg-[#0B0B0D] px-4 pb-10 pt-5 text-white sm:px-5 lg:px-8">
    <div className="mx-auto w-full max-w-[1280px] space-y-6 lg:space-y-7">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#1DBB54]">ALTHEA PAY</p><h1 className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.055em] sm:text-[34px]">Olá, {operatorName} 👋</h1><p className="mt-3 text-sm leading-6 text-[#919b96] sm:text-[15px]">Aqui está o resumo geral da sua operação.</p></div>
        <div className="flex items-center gap-2 self-start lg:self-end"><button type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Atualizar dados" className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] transition hover:border-[#1DBB54]/40 hover:text-white disabled:opacity-50"><RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} /></button><button type="button" onClick={() => setHideValues(value => !value)} aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'} className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] transition hover:border-[#1DBB54]/40 hover:text-white">{hideValues ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      </header>
      <div className="flex items-center gap-2 text-[11px] font-mono text-[#1DBB54]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#1DBB54]" /><span>Última atualização: {updated}</span></div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:gap-7">
        <main className="min-w-0 space-y-5 lg:col-span-2">
          <section className="flex w-full items-center gap-2"><div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">{([7, 30, 90] as RangeDays[]).map(days => <button key={days} type="button" onClick={() => setRangeDays(days)} className={`min-w-[78px] rounded-[12px] border px-5 py-2.5 text-xs font-semibold transition sm:min-w-[82px] ${rangeDays === days ? 'border-[#1DBB54]/70 bg-[#1DBB54]/[0.08] text-[#1DBB54] shadow-[0_0_20px_rgba(29,187,84,0.08)]' : 'border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] hover:text-white'}`}>{days}D</button>)}</div><span className="hidden shrink-0 text-xs font-mono text-[#707b76] md:block">{periodLabel}</span><button type="button" onClick={() => setFilterOpen(value => !value)} aria-expanded={filterOpen} aria-label="Abrir filtro de período" className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border transition ${filterOpen ? 'border-[#1DBB54]/70 bg-[#1DBB54]/[0.08] text-[#1DBB54]' : 'border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] hover:text-white'}`}><Filter size={17} /></button></section>
          {filterOpen && <div className="rounded-[16px] border border-[#1DBB54]/20 bg-[#0F1A16] p-4 text-xs text-[#A6A6A6]"><div className="flex items-center justify-between gap-3"><span>Período ativo</span><strong className="text-[#1DBB54]">Últimos {rangeDays} dias</strong></div><div className="mt-2 text-[10px] text-[#69746f]">{periodLabel}</div></div>}
          {error && <div className="flex w-full items-start gap-3 rounded-[16px] border border-red-500/25 bg-red-950/20 p-4 sm:p-5"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-red-200">Sincronização indisponível</p><p className="mt-1 text-xs leading-5 text-red-200/70">{error}</p></div><button type="button" onClick={() => void load()} className="shrink-0 rounded-[10px] border border-red-300/20 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/10">Tentar</button></div>}
          <article className="relative min-h-[230px] w-full overflow-hidden rounded-[16px] border border-[#1DBB54]/35 bg-[#0F1A16] p-5 shadow-[0_32px_64px_rgba(0,0,0,0.35)] sm:p-6 lg:min-h-[270px]"><div className="relative z-10"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A6A6A6]">Faturamento Líquido Consolidado</p><strong className="mt-6 block truncate text-[40px] font-semibold leading-none tracking-[-0.06em] sm:text-[48px] lg:text-[52px]">{loading ? '••••••' : hideValues ? '••••••' : money(revenue)}</strong><div className="mt-7 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-4 text-xs"><span className={revenueChange >= 0 ? 'text-[#1DBB54]' : 'text-rose-400'}>{trend}</span><span className="text-[#7e8883]">em relação ao período anterior</span></div></div><svg className="absolute inset-x-0 bottom-0 h-[68%] w-full opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="dashboardArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1DBB54" stopOpacity=".24" /><stop offset="1" stopColor="#1DBB54" stopOpacity="0" /></linearGradient></defs><path d="M0 94 C22 92 35 82 48 78 C63 74 69 56 80 39 C88 27 94 21 100 16 L100 100 L0 100Z" fill="url(#dashboardArea)" /><path d="M0 94 C22 92 35 82 48 78 C63 74 69 56 80 39 C88 27 94 21 100 16" fill="none" stroke="#1DBB54" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><circle cx="100" cy="16" r="2.2" fill="#1DBB54" /></svg></article>
          <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4"><Metric label="Vendas" value={String(periodSales.length)} icon={ShoppingCart} hidden={hideValues} detail={`${approvedSales.length} aprovadas`} /><Metric label="Aprovadas" value={String(approvedSales.length)} icon={CheckCircle2} hidden={hideValues} detail={`${approvalRate.toFixed(1).replace('.', ',')}% de aprovação`} /><Metric label="Ticket médio" value={money(ticket)} icon={Ticket} hidden={hideValues} detail="por venda aprovada" /><Metric label="Pendentes" value={String(pendingSales.length)} icon={Clock3} hidden={hideValues} detail={`${customers} clientes no período`} /></div>
          <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold tracking-wide text-white">Vendas recentes</h2><span className="text-[10px] font-mono text-[#66716c]">{rangeDays}D</span></div><div className="w-full overflow-hidden rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-4">{loading ? <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-[12px] bg-white/[0.03]" />)}</div> : latestSales.length === 0 ? <div className="py-10 text-center"><Wallet className="mx-auto h-8 w-8 text-[#1DBB54]/60" /><p className="mt-3 text-sm font-medium text-[#dfe6e2]">Nenhuma venda no período</p><p className="mt-1 text-xs text-[#69746f]">As vendas autorizadas aparecerão aqui.</p></div> : <div>{latestSales.map(sale => <div key={sale.id} className="flex items-center gap-3 border-b border-white/[0.04] py-3.5 last:border-0 last:pb-0 first:pt-0"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#1DBB54]/15 bg-[#0D362D] text-[#1DBB54]"><ShoppingCart size={15} /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-white">{customerName(sale)}</p><p className="mt-1 text-[10px] text-[#68736e]">{dateTime(sale.occurred_at ?? sale.created_at)}</p></div><div className="shrink-0 text-right"><p className="text-xs font-semibold">{hideValues ? '••••' : money(amountOf(sale))}</p><p className={`mt-1 text-[9px] ${approved(sale) ? 'text-[#1DBB54]' : 'text-[#89938e]'}`}>{approved(sale) ? 'Aprovada' : pending(sale) ? 'Pendente' : 'Processando'}</p></div></div>)}</div>}</div></section>
        </main>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-5">
          <section className="w-full rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-5"><div className="flex items-center gap-2"><Activity size={17} className="text-[#1DBB54]" /><h2 className="text-sm font-semibold text-white">Telemetria operacional</h2></div><div className="mt-5 space-y-3"><Telemetry label="Status" value={error ? 'Atenção' : loading ? 'Sincronizando' : 'Operacional'} positive={!error && !loading} /><Telemetry label="Vendas no período" value={String(periodSales.length)} /><Telemetry label="Aprovação" value={`${approvalRate.toFixed(1).replace('.', ',')}%`} positive={approvalRate >= 50 && periodSales.length > 0} /><Telemetry label="Clientes" value={String(customers)} /></div></section>
          <section className="w-full rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-5"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#A6A6A6]">Período selecionado</p><p className="mt-3 text-xl font-semibold text-white">Últimos {rangeDays} dias</p><p className="mt-1 text-xs text-[#69746f]">{periodLabel}</p><div className="mt-5 h-px bg-white/[0.04]" /><div className="mt-4 flex items-center justify-between text-xs"><span className="text-[#69746f]">Faturamento</span><strong className="text-white">{hideValues ? '••••••' : money(revenue)}</strong></div></section>
        </aside>
      </div>
    </div>
  </section>
}

function Metric({ label, value, detail, icon: Icon, hidden }: { label: string; value: string; detail: string; icon: typeof ShoppingCart; hidden: boolean }) {
  return <article className="min-w-0 w-full rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-4"><div className="flex items-start justify-between gap-2"><span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A6A6A6]">{label}</span><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[#0D362D] text-[#1DBB54]"><Icon size={16} /></span></div><strong className="mt-5 block truncate text-[23px] font-semibold tracking-[-0.04em]">{hidden ? '••••' : value}</strong><span className="mt-2 block truncate text-[10px] text-[#737d79]">{detail}</span></article>
}

function Telemetry({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/[0.04] bg-[#0D362D]/35 px-3 py-3"><span className="text-xs text-[#7f8a84]">{label}</span><span className={`text-xs font-semibold ${positive ? 'text-[#1DBB54]' : 'text-white'}`}>{value}</span></div>
}
