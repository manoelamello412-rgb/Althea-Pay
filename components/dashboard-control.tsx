'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, Eye, EyeOff, Filter, RefreshCw, ShoppingCart, Ticket, Wallet } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Sale = {
  id: string
  amount: number | string | null
  status: string | null
  customer_id: string | null
  data: Record<string, unknown> | null
  gateway_id: string | null
  occurred_at: string | null
  created_at: string | null
}

type RangeDays = 7 | 30 | 90
const TIME_ZONE = 'America/Sao_Paulo'
const APPROVED = new Set(['approved', 'completed', 'paid', 'success', 'succeeded', 'authorized'])
const PENDING = new Set(['pending', 'processing', 'waiting', 'waiting_payment', 'in_review', 'in_analysis'])

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const parseDate = (value: string) => { const [y,m,d] = value.split('-').map(Number); return new Date(y, m - 1, d) }
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const addDays = (value: string, amount: number) => { const d = parseDate(value); d.setDate(d.getDate()+amount); return iso(d) }
const amountOf = (sale: Sale) => { const n = Number(sale.amount ?? sale.data?.amount ?? 0); return Number.isFinite(n) ? n : 0 }
const statusOf = (sale: Sale) => String(sale.status ?? '').trim().toLowerCase()
const approved = (sale: Sale) => APPROVED.has(statusOf(sale))
const pending = (sale: Sale) => PENDING.has(statusOf(sale))
const dateOf = (sale: Sale) => String(sale.occurred_at ?? sale.created_at ?? '').slice(0,10)
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number.isFinite(value) ? value : 0)
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—'
const customerName = (sale: Sale) => {
  const data = sale.data ?? {}
  const customer = data.customer && typeof data.customer === 'object' ? data.customer as Record<string, unknown> : null
  const name = data.customer_name ?? data.name ?? customer?.name ?? customer?.full_name
  if (typeof name === 'string' && name.trim()) return name.trim()
  const email = data.customer_email ?? data.email ?? customer?.email
  if (typeof email === 'string' && email.trim()) return email.trim()
  return sale.customer_id ? `Cliente ${sale.customer_id.slice(0,6).toUpperCase()}` : 'Cliente'
}

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

  const range = useMemo(() => { const end=today(); return { start:addDays(end,-(rangeDays-1)), end } }, [rangeDays])
  const previousRange = useMemo(() => ({ start:addDays(range.start,-rangeDays), end:addDays(range.start,-1) }), [range,rangeDays])

  const load = useCallback(async (silent=false) => {
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
      const { data, error: queryError } = await db.from('sales')
        .select('id,amount,status,customer_id,data,gateway_id,occurred_at,created_at')
        .gte('created_at', `${since}T00:00:00-03:00`)
        .order('created_at', { ascending:false })
        .limit(5000)
      if (queryError) throw queryError
      setSales((data ?? []) as Sale[])
      setLastUpdated(new Date())
    } catch (cause) {
      console.error('[ALTHEA-DASHBOARD]', cause)
      setError('Não foi possível sincronizar os dados agora.')
    } finally {
      silent ? setRefreshing(false) : setLoading(false)
    }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => { const h=()=>void load(true); window.addEventListener('althea-refresh',h); return()=>window.removeEventListener('althea-refresh',h) }, [load])
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null
    let cancelled=false
    const subscribe=async()=>{
      const { data: auth }=await db.auth.getUser()
      if(cancelled || !auth.user) return
      channel=db.channel(`althea-dashboard-sales-${auth.user.id}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'sales'},()=>void load(true))
        .subscribe()
    }
    void subscribe()
    return()=>{ cancelled=true; if(channel) void db.removeChannel(channel) }
  },[db,load])

  const periodSales=useMemo(()=>sales.filter(s=>dateOf(s)>=range.start&&dateOf(s)<=range.end),[sales,range])
  const previousSales=useMemo(()=>sales.filter(s=>dateOf(s)>=previousRange.start&&dateOf(s)<=previousRange.end),[sales,previousRange])
  const approvedSales=useMemo(()=>periodSales.filter(approved),[periodSales])
  const pendingSales=useMemo(()=>periodSales.filter(pending),[periodSales])
  const revenue=useMemo(()=>approvedSales.reduce((sum,s)=>sum+amountOf(s),0),[approvedSales])
  const ticket=approvedSales.length?revenue/approvedSales.length:0
  const approvalRate=periodSales.length?(approvedSales.length/periodSales.length)*100:0
  const previousRevenue=useMemo(()=>previousSales.filter(approved).reduce((sum,s)=>sum+amountOf(s),0),[previousSales])
  const revenueChange=previousRevenue===0?(revenue>0?100:0):((revenue-previousRevenue)/previousRevenue)*100
  const customers=useMemo(()=>new Set(periodSales.map(s=>s.customer_id).filter(Boolean)).size,[periodSales])
  const latestSales=periodSales.slice(0,5)
  const updated=lastUpdated?new Intl.DateTimeFormat('pt-BR',{timeZone:TIME_ZONE,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(lastUpdated):'Sincronizando…'
  const periodLabel=`${new Intl.DateTimeFormat('pt-BR',{timeZone:TIME_ZONE,day:'2-digit',month:'2-digit'}).format(parseDate(range.start))} — ${new Intl.DateTimeFormat('pt-BR',{timeZone:TIME_ZONE,day:'2-digit',month:'2-digit'}).format(parseDate(range.end))}`
  const trend=`${revenueChange>=0?'↑':'↓'} ${Math.abs(revenueChange).toFixed(1).replace('.',',')}%`

  return <section className="w-full bg-[#0B0B0D] px-4 pb-10 pt-5 text-white">
    <div className="mx-auto w-full max-w-xl space-y-6">
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#1DB854]">ALTHEA PAY</p><h1 className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.055em]">Olá, {operatorName} 👋</h1><p className="mt-3 max-w-[300px] text-[16px] leading-6 text-[#919b96]">Aqui está o resumo geral da sua operação.</p></div>
          <div className="flex shrink-0 gap-2"><button type="button" onClick={()=>void load(true)} disabled={refreshing} aria-label="Atualizar dados" className="grid h-11 w-11 place-items-center rounded-[14px] border border-white/[0.09] bg-[#0d0f0e] text-[#a8b0ac] transition hover:border-[#1DB854]/35 hover:text-white disabled:opacity-50"><RefreshCw size={19} className={refreshing?'animate-spin':''}/></button><button type="button" onClick={()=>setHideValues(v=>!v)} aria-label={hideValues?'Mostrar valores':'Ocultar valores'} className="grid h-11 w-11 place-items-center rounded-[14px] border border-white/[0.09] bg-[#0d0f0e] text-[#a8b0ac] hover:text-white">{hideValues?<EyeOff size={19}/>:<Eye size={19}/>}</button></div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[#1DB854]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#1DB854]"/>Última atualização: {updated}</div>
      </section>

      <section className="flex items-center gap-2"><div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1">{([7,30,90] as RangeDays[]).map(days=><button key={days} type="button" onClick={()=>setRangeDays(days)} className={`min-w-[82px] rounded-full border px-6 py-3 text-[14px] font-medium transition ${rangeDays===days?'border-[#1DB854] bg-[#0b2016] text-[#1DB854] shadow-[0_0_0_1px_rgba(29,184,84,.12)]':'border-white/[0.08] bg-[#0d0e0e] text-[#8f9894] hover:text-white'}`}>{days}D</button>)}</div><div className="hidden shrink-0 text-xs font-mono text-[#707b76] md:block">{periodLabel}</div><button type="button" onClick={()=>setFilterOpen(v=>!v)} aria-expanded={filterOpen} aria-label="Abrir filtro de período" className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${filterOpen?'border-[#1DB854] text-[#1DB854] bg-[#0b2016]':'border-white/[0.08] bg-[#0d0e0e] text-[#8d9792]'}`}><Filter size={17}/></button></section>
      {filterOpen && <div className="rounded-2xl border border-[#1DB854]/20 bg-[#0b1510] p-4 text-xs text-[#89938e]"><div className="flex items-center justify-between gap-3"><span>Período ativo</span><strong className="text-[#1DB854]">Últimos {rangeDays} dias</strong></div><div className="mt-2 text-[10px] text-[#64716b]">{periodLabel}</div></div>}

      {error && <div className="rounded-2xl border border-rose-500/35 bg-rose-950/20 p-5"><p className="text-base font-semibold text-rose-200">Sincronização indisponível</p><p className="mt-2 text-sm leading-6 text-rose-200/70">{error}</p><button type="button" onClick={()=>void load()} className="mt-4 rounded-xl border border-rose-300/30 px-5 py-3 text-sm font-medium text-rose-100 hover:bg-rose-500/10">Tentar novamente</button></div>}

      <article className="relative overflow-hidden rounded-[22px] border border-[#1DB854]/45 bg-[#090f0c] p-5 shadow-[0_18px_70px_rgba(0,0,0,.28)]"><div className="relative z-10"><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8b9791]">Faturamento</p><strong className="mt-6 block text-[48px] font-semibold leading-none tracking-[-0.06em]">{loading?'••••••':hideValues?'••••••':money(revenue)}</strong><div className="mt-7 flex items-center gap-2 border-t border-white/[0.06] pt-4 text-xs"><span className={revenueChange>=0?'text-[#1DB854]':'text-rose-400'}>{trend}</span><span className="text-[#7e8883]">em relação ao período anterior</span></div></div><svg className="absolute inset-x-0 bottom-0 h-[72%] w-full opacity-70" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="dashboardArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1DB854" stopOpacity=".25"/><stop offset="1" stopColor="#1DB854" stopOpacity="0"/></linearGradient></defs><path d="M0 94 C22 92 35 82 48 78 C63 74 69 56 80 39 C88 27 94 21 100 16 L100 100 L0 100Z" fill="url(#dashboardArea)"/><path d="M0 94 C22 92 35 82 48 78 C63 74 69 56 80 39 C88 27 94 21 100 16" fill="none" stroke="#1DB854" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/><circle cx="100" cy="16" r="2.2" fill="#1DB854"/></svg></article>

      <div className="grid grid-cols-2 gap-3"><Metric label="Vendas" value={String(periodSales.length)} icon={ShoppingCart} hidden={hideValues} detail={`${approvedSales.length} aprovadas`}/><Metric label="Aprovadas" value={String(approvedSales.length)} icon={CheckCircle2} hidden={hideValues} detail={`${approvalRate.toFixed(1).replace('.',',')}% de aprovação`}/><Metric label="Ticket médio" value={money(ticket)} icon={Ticket} hidden={hideValues} detail="por venda aprovada"/><Metric label="Pendentes" value={String(pendingSales.length)} icon={Clock3} hidden={hideValues} detail={`${customers} clientes no período`}/></div>

      <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-medium tracking-wide text-[#e9eeeb]">Vendas recentes</h2><span className="text-[10px] font-mono text-[#66716c]">{rangeDays}D</span></div><div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0c0d0d] p-4">{loading?<div className="space-y-4">{[1,2,3].map(i=><div key={i} className="h-12 animate-pulse rounded-xl bg-white/[0.04]"/>)}</div>:latestSales.length===0?<div className="py-10 text-center"><Wallet className="mx-auto h-8 w-8 text-[#1DB854]/60"/><p className="mt-3 text-sm font-medium text-[#dfe6e2]">Nenhuma venda no período</p><p className="mt-1 text-xs text-[#69746f]">As vendas autorizadas aparecerão aqui.</p></div>:<div>{latestSales.map(s=><div key={s.id} className="flex items-center gap-3 border-b border-white/[0.05] py-3.5 last:border-0 last:pb-0 first:pt-0"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#1DB854]/15 bg-[#0e1712] text-[#1DB854]"><ShoppingCart size={15}/></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-white">{customerName(s)}</p><p className="mt-1 text-[10px] text-[#68736e]">{dateTime(s.occurred_at ?? s.created_at)}</p></div><div className="shrink-0 text-right"><p className="text-xs font-semibold">{hideValues?'••••':money(amountOf(s))}</p><p className={`mt-1 text-[9px] ${approved(s)?'text-[#1DB854]':'text-[#89938e]'}`}>{approved(s)?'Aprovada':pending(s)?'Pendente':'Processando'}</p></div></div>)}</div>}</div></section>
    </div>
  </section>
}

function Metric({ label, value, detail, icon: Icon, hidden }: { label:string; value:string; detail:string; icon:typeof ShoppingCart; hidden:boolean }) { return <article className="min-w-0 rounded-[18px] border border-white/[0.07] bg-[#0c0d0e] p-4 shadow-[0_14px_50px_rgba(0,0,0,.18)]"><div className="flex items-start justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7d8984]">{label}</span><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#1DB854]/15 bg-[#0f1713] text-[#1DB854]"><Icon size={16}/></span></div><strong className="mt-5 block truncate text-[25px] font-semibold tracking-[-0.04em]">{hidden?'••••':value}</strong><span className="mt-2 block truncate text-[10px] text-[#737d79]">{detail}</span></article> }
