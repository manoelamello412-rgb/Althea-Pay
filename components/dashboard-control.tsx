'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, Eye, EyeOff, Filter, RefreshCw, ShoppingCart, Ticket, Users, Wallet } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { addDays, amountOf, calculateSalesAnalytics, customerNameOf, makePreviousRange, makeRange, type AnalyticsSale } from '@/lib/analytics/sales'

type RangeDays = 7 | 30 | 90

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)
const shortDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00-03:00`))
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
const statusLabel = (status: string | null) => ({ approved: 'Aprovada', pending: 'Pendente', failed: 'Falhou', cancelled: 'Cancelada', refunded: 'Reembolsada', chargeback: 'Chargeback' } as Record<string, string>)[String(status ?? '').toLowerCase()] ?? 'Outro'
const statusClass = (status: string | null) => { switch (String(status ?? '').toLowerCase()) { case 'approved': return 'border-[#1DBB54]/25 bg-[#1DBB54]/[0.08] text-[#1DBB54]'; case 'pending': return 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300'; case 'failed': case 'cancelled': return 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300'; case 'refunded': case 'chargeback': return 'border-violet-400/20 bg-violet-400/[0.06] text-violet-300'; default: return 'border-white/[0.06] bg-white/[0.03] text-[#A6A6A6]' } }

export default function DashboardControl() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [sales, setSales] = useState<AnalyticsSale[]>([])
  const [operatorName, setOperatorName] = useState('Operador')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hideValues, setHideValues] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const range = useMemo(() => makeRange(rangeDays), [rangeDays])
  const previousRange = useMemo(() => makePreviousRange(range, rangeDays), [range, rangeDays])

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
      const since = addDays(range.start, -1)
      const { data, error: queryError } = await db.from('sales').select('id,amount,status,customer_id,data,gateway_id,external_id,transaction_id,occurred_at,created_at').gte('occurred_at', `${since}T00:00:00-03:00`).order('occurred_at', { ascending: false }).limit(5000)
      if (queryError) throw queryError
      setSales((data ?? []) as AnalyticsSale[])
      setLastUpdated(new Date())
    } catch (cause) {
      console.error('[ALTHEA-DASHBOARD]', cause)
      setError('Não foi possível sincronizar as vendas reais agora.')
    } finally { silent ? setRefreshing(false) : setLoading(false) }
  }, [db, range.start])

  useEffect(() => { void load() }, [load])
  useEffect(() => { const handler = () => void load(true); window.addEventListener('althea-refresh', handler); return () => window.removeEventListener('althea-refresh', handler) }, [load])
  useEffect(() => { let channel: ReturnType<typeof db.channel> | null = null; let cancelled = false; const subscribe = async () => { const { data: auth } = await db.auth.getUser(); if (cancelled || !auth.user) return; channel = db.channel(`althea-dashboard-sales-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => void load(true)).subscribe() }; void subscribe(); return () => { cancelled = true; if (channel) void db.removeChannel(channel) } }, [db, load])

  const analytics = useMemo(() => calculateSalesAnalytics(sales, range, previousRange), [sales, range, previousRange])
  const latestSales = analytics.sales.slice(0, 5)
  const trend = `${analytics.revenueChange >= 0 ? '↑' : '↓'} ${Math.abs(analytics.revenueChange).toFixed(1).replace('.', ',')}%`
  const updated = lastUpdated ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastUpdated) : 'Sincronizando…'
  const periodLabel = `${shortDate(range.start)} — ${shortDate(range.end)}`
  const maxDailyRevenue = Math.max(...analytics.dailyRevenue.map((point) => point.revenue), 1)
  const chartPoints = analytics.dailyRevenue.length > 31 ? analytics.dailyRevenue.filter((_, index) => index % Math.ceil(analytics.dailyRevenue.length / 31) === 0) : analytics.dailyRevenue

  return <section className="w-full bg-[#0B0B0D] px-4 pb-10 pt-5 text-white sm:px-5 lg:px-8">
    <div className="mx-auto w-full max-w-[1280px] space-y-6 lg:space-y-7">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#1DBB54]">ALTHEA PAY</p><h1 className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.055em] sm:text-[34px]">Olá, {operatorName} 👋</h1><p className="mt-3 text-sm leading-6 text-[#919b96] sm:text-[15px]">Resumo financeiro baseado exclusivamente nas vendas registradas.</p></div>
        <div className="flex items-center gap-2 self-start lg:self-end"><button type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Atualizar dados" className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] transition hover:border-[#1DBB54]/40 hover:text-white disabled:opacity-50"><RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} /></button><button type="button" onClick={() => setHideValues(value => !value)} aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'} className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] transition hover:border-[#1DBB54]/40 hover:text-white">{hideValues ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      </header>
      <div className="flex items-center gap-2 text-[11px] font-mono text-[#1DBB54]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#1DBB54]" /><span>Última atualização: {updated}</span></div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:gap-7">
        <main className="min-w-0 space-y-5 lg:col-span-2">
          <section className="flex w-full items-center gap-2"><div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">{([7, 30, 90] as RangeDays[]).map(days => <button key={days} type="button" onClick={() => setRangeDays(days)} className={`min-w-[78px] rounded-[12px] border px-5 py-2.5 text-xs font-semibold transition sm:min-w-[82px] ${rangeDays === days ? 'border-[#1DBB54]/70 bg-[#1DBB54]/[0.08] text-[#1DBB54] shadow-[0_0_20px_rgba(29,187,84,0.08)]' : 'border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] hover:text-white'}`}>{days}D</button>)}</div><span className="hidden shrink-0 text-xs font-mono text-[#707b76] md:block">{periodLabel}</span><button type="button" onClick={() => setFilterOpen(value => !value)} aria-expanded={filterOpen} aria-label="Abrir filtro de período" className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border transition ${filterOpen ? 'border-[#1DBB54]/70 bg-[#1DBB54]/[0.08] text-[#1DBB54]' : 'border-white/[0.06] bg-[#0F1A16] text-[#A6A6A6] hover:text-white'}`}><Filter size={17} /></button></section>
          {filterOpen && <div className="rounded-[16px] border border-[#1DBB54]/20 bg-[#0F1A16] p-4 text-xs text-[#A6A6A6]"><div className="flex items-center justify-between gap-3"><span>Período ativo</span><strong className="text-[#1DBB54]">Últimos {rangeDays} dias</strong></div><div className="mt-2 text-[10px] text-[#69746f]">{periodLabel} · America/Sao_Paulo</div></div>}
          {error && <div className="flex w-full items-start gap-3 rounded-[16px] border border-red-500/25 bg-red-950/20 p-4 sm:p-5"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-red-200">Sincronização indisponível</p><p className="mt-1 text-xs leading-5 text-red-200/70">{error}</p></div><button type="button" onClick={() => void load()} className="shrink-0 rounded-[10px] border border-red-300/20 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/10">Tentar</button></div>}
          <article className="relative min-h-[230px] w-full overflow-hidden rounded-[16px] border border-[#1DBB54]/35 bg-[#0F1A16] p-5 shadow-[0_32px_64px_rgba(0,0,0,0.35)] sm:p-6 lg:min-h-[270px]"><div className="relative z-10"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A6A6A6]">Faturamento aprovado</p><strong className="mt-6 block truncate text-[40px] font-semibold leading-none tracking-[-0.06em] sm:text-[48px] lg:text-[52px]">{loading ? '••••••' : hideValues ? '••••••' : money(analytics.approvedRevenue)}</strong><div className="mt-7 flex flex-wrap items-center gap-2 border-t border-white/[0.05] pt-4 text-xs"><span className={analytics.revenueChange >= 0 ? 'text-[#1DBB54]' : 'text-rose-400'}>{trend}</span><span className="text-[#7e8883]">em relação ao período anterior</span></div></div><div className="absolute inset-x-0 bottom-0 flex h-[42%] items-end gap-[2px] px-3 opacity-70" aria-label="Receita diária aprovada">{chartPoints.map(point => <div key={point.date} className="group relative flex h-full flex-1 items-end"><div className="w-full rounded-t-[3px] bg-[#1DBB54]/45 transition group-hover:bg-[#1DBB54]/75" style={{ height: `${Math.max(3, (point.revenue / maxDailyRevenue) * 100)}%` }} /></div>)}</div></article>
          <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4"><Metric label="Vendas" value={String(analytics.sales.length)} icon={ShoppingCart} hidden={hideValues} detail={`${analytics.approved.length} aprovadas`} /><Metric label="Taxa de aprovação" value={`${analytics.approvalRate.toFixed(1).replace('.', ',')}%`} icon={CheckCircle2} hidden={hideValues} detail={`${analytics.decidedCount} decididas`} /><Metric label="Ticket médio" value={money(analytics.averageTicket)} icon={Ticket} hidden={hideValues} detail="por venda aprovada" /><Metric label="Clientes" value={String(analytics.uniqueCustomers)} icon={Users} hidden={hideValues} detail="clientes identificados" /></div>
          <section className="overflow-hidden rounded-[16px] border border-white/[0.04] bg-[#0F1A16]"><div className="flex items-center justify-between gap-3 border-b border-white/[0.04] px-5 py-4 sm:px-6"><div><h2 className="text-sm font-semibold">Últimas transações</h2><p className="mt-1 text-[11px] text-[#737d78]">Ordenadas pelo momento da ocorrência.</p></div><span className="text-[10px] font-mono text-[#1DBB54]">{analytics.sales.length} no período</span></div>{loading?<div className="px-5 py-10 text-center text-xs text-[#737d78]">Sincronizando dados reais…</div>:latestSales.length?<div className="divide-y divide-white/[0.04]">{latestSales.map(sale=><div key={sale.id} className="flex items-center gap-3 px-5 py-4 sm:px-6"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{customerNameOf(sale)}</p><p className="mt-1 truncate text-[10px] font-mono text-[#68736e]">{dateTime(sale.occurred_at ?? sale.created_at)} · {sale.gateway_id ?? 'Gateway não informado'}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold">{hideValues?'••••':money(amountOf(sale))}</p><span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusClass(sale.status)}`}>{statusLabel(sale.status)}</span></div></div>)}</div>:<div className="px-5 py-10 text-center"><Wallet className="mx-auto h-7 w-7 text-[#53605a]" /><p className="mt-3 text-sm font-medium">Nenhuma venda no período</p><p className="mt-1 text-xs text-[#737d78]">Quando uma venda ocorrer, ela aparecerá aqui automaticamente.</p></div>}</section>
        </main>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-5 sm:p-6"><div className="flex items-center gap-2 text-[#A6A6A6]"><Clock3 size={16} /><span className="text-xs font-semibold">Status operacional</span></div><div className="mt-5 grid grid-cols-2 gap-3"><SideStat label="Pendentes" value={analytics.pending.length} /><SideStat label="Falharam" value={analytics.failed.length} /><SideStat label="Canceladas" value={analytics.cancelled.length} /><SideStat label="Reembolsadas" value={analytics.refunded.length} /></div></section>
          <section className="rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#A6A6A6]">Período</p><p className="mt-2 text-sm font-semibold">{periodLabel}</p></div><div className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#1DBB54]/[0.08] text-[#1DBB54]"><Wallet size={17} /></div></div><div className="mt-5 space-y-3 border-t border-white/[0.04] pt-4 text-xs"><Row label="Aprovadas" value={String(analytics.approved.length)} /><Row label="Pendentes" value={String(analytics.pending.length)} /><Row label="Decididas" value={String(analytics.decidedCount)} /><Row label="Receita aprovada" value={hideValues?'••••••':money(analytics.approvedRevenue)} strong /></div></section>
        </aside>
      </div>
    </div>
  </section>
}

function Metric({ label, value, icon: Icon, hidden, detail }: { label: string; value: string; icon: typeof ShoppingCart; hidden: boolean; detail: string }) {
  return <article className="rounded-[16px] border border-white/[0.04] bg-[#0F1A16] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7d8882]">{label}</span><Icon size={15} className="text-[#1DBB54]" /></div><strong className="mt-4 block truncate text-[24px] font-semibold tracking-[-0.04em]">{hidden?'••••':value}</strong><p className="mt-1 truncate text-[10px] text-[#68736e]">{detail}</p></article>
}
function SideStat({ label, value }: { label: string; value: number }) { return <div className="rounded-[12px] border border-white/[0.04] bg-[#0D362D]/45 p-3"><span className="block text-[10px] text-[#78837d]">{label}</span><strong className="mt-1 block text-lg font-semibold">{value}</strong></div> }
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className="flex items-center justify-between gap-4"><span className="text-[#7d8882]">{label}</span><strong className={strong?'text-[#1DBB54]':'text-white'}>{value}</strong></div> }
