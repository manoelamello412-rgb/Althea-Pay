'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, RefreshCw, TrendingUp, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Transaction = { id: string; amount: number | null; currency: string | null; status: string; funnel_id: string | null; gateway_id: string | null; created_at: string; completed_at: string | null }
type Checkout = { id: string; status: string; amount: number | null; created_at: string; completed_at: string | null }

const money = (value: number, currency = 'BRL') => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const pct = (value: number) => `${value.toFixed(1)}%`

export default function AnalyticsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [checkouts, setCheckouts] = useState<Checkout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<7 | 30 | 90>(30)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setTransactions([]); setCheckouts([]); return }
      const since = new Date(Date.now() - period * 86400000).toISOString()
      const [tx, co] = await Promise.all([
        db.from('gateway_transactions').select('id,amount,currency,status,funnel_id,gateway_id,created_at,completed_at').eq('user_id', auth.user.id).gte('created_at', since).order('created_at', { ascending: false }).limit(10000),
        db.from('checkout_sessions').select('id,status,amount,created_at,completed_at').eq('user_id', auth.user.id).gte('created_at', since).order('created_at', { ascending: false }).limit(10000),
      ])
      if (tx.error) throw tx.error
      if (co.error) throw co.error
      setTransactions((tx.data ?? []) as Transaction[])
      setCheckouts((co.data ?? []) as Checkout[])
    } catch (cause) {
      console.error('[ALTHEA-ANALYTICS]', cause)
      setError('Não foi possível carregar as métricas reais.')
    } finally { setLoading(false) }
  }, [db, period])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof db.channel> | null = null
    void db.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return
      channel = db.channel(`analytics-${data.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `user_id=eq.${data.user.id}` }, () => void load()).on('postgres_changes', { event: '*', schema: 'public', table: 'checkout_sessions', filter: `user_id=eq.${data.user.id}` }, () => void load()).subscribe()
    })
    return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  const metrics = useMemo(() => {
    const approved = transactions.filter(t => t.status === 'approved')
    const pending = transactions.filter(t => t.status === 'pending')
    const failed = transactions.filter(t => t.status === 'failed')
    const gross = approved.reduce((sum, t) => sum + Number(t.amount ?? 0), 0)
    const checkoutCompleted = checkouts.filter(c => c.status === 'completed' || c.completed_at)
    const conversion = checkouts.length ? checkoutCompleted.length / checkouts.length * 100 : 0
    const average = approved.length ? gross / approved.length : 0
    return { approved, pending, failed, gross, conversion, average }
  }, [transactions, checkouts])

  const funnelRows = useMemo(() => {
    const map = new Map<string, { total: number; approved: number; gross: number }>()
    for (const t of transactions) {
      const key = t.funnel_id || 'sem_funil'
      const row = map.get(key) ?? { total: 0, approved: 0, gross: 0 }
      row.total++
      if (t.status === 'approved') { row.approved++; row.gross += Number(t.amount ?? 0) }
      map.set(key, row)
    }
    return [...map.entries()].sort((a, b) => b[1].gross - a[1].gross).slice(0, 8)
  }, [transactions])

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8"><div className="mx-auto max-w-[1700px]">
    <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // ANALYTICS</div><h1 className="text-3xl font-black tracking-tight">Analytics</h1><p className="mt-1 text-sm text-slate-500">Leitura operacional dos eventos reais de checkout e transações.</p></div><div className="flex gap-2"><div className="flex rounded-xl border border-white/10 bg-white/[.025] p-1">{([7,30,90] as const).map(days => <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-lg px-3 py-2 text-xs font-bold ${period === days ? 'bg-white/10 text-white' : 'text-slate-500'}`}>{days}d</button>)}</div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="rounded-xl border border-white/10 bg-white/[.03] p-2.5 text-slate-300"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button></div></header>
    {error ? <div className="mb-5 flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm"><X size={17} className="text-red-400" />{error}</div> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Receita aprovada</span><strong className="mt-2 block text-2xl font-black">{loading ? '—' : money(metrics.gross)}</strong><small className="mt-2 block text-xs text-slate-600">Somente transações aprovadas</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Transações aprovadas</span><strong className="mt-2 block text-2xl font-black">{loading ? '—' : metrics.approved.length}</strong><small className="mt-2 block text-xs text-slate-600">De {transactions.length} transações</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Conversão de checkout</span><strong className="mt-2 block text-2xl font-black">{loading ? '—' : pct(metrics.conversion)}</strong><small className="mt-2 block text-xs text-slate-600">Sessões concluídas / iniciadas</small></article><article className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><span className="text-[10px] uppercase tracking-widest text-slate-500">Ticket médio</span><strong className="mt-2 block text-2xl font-black">{loading ? '—' : money(metrics.average)}</strong><small className="mt-2 block text-xs text-slate-600">Por transação aprovada</small></article></section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_.8fr]"><div className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-black">Desempenho por funil</h2><p className="text-xs text-slate-600">Receita e aprovação no período selecionado.</p></div><BarChart3 size={19} className="text-slate-600" /></div>{funnelRows.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center text-center"><Activity size={24} className="mb-2 text-slate-700" /><b>Nenhum dado no período</b><p className="mt-1 text-xs text-slate-600">As métricas serão preenchidas quando eventos reais chegarem.</p></div> : <div className="space-y-3">{funnelRows.map(([id,row]) => <div key={id} className="rounded-xl border border-white/[.06] p-4"><div className="flex items-center justify-between gap-3"><span className="truncate font-mono text-xs text-slate-400">{id}</span><strong className="text-sm">{money(row.gross)}</strong></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${row.total ? Math.min(100, row.approved / row.total * 100) : 0}%` }} /></div><div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-slate-600"><span>{row.approved}/{row.total} aprovadas</span><span>{row.total ? pct(row.approved / row.total * 100) : '0.0%'}</span></div></div>)}</div>}</div>
    <div className="rounded-2xl border border-white/10 bg-white/[.02] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-black">Estado operacional</h2><p className="text-xs text-slate-600">Distribuição das transações.</p></div><TrendingUp size={19} className="text-slate-600" /></div><div className="space-y-3"><div className="flex items-center justify-between rounded-xl border border-white/[.06] p-4"><span className="text-sm text-slate-400">Aprovadas</span><b>{metrics.approved.length}</b></div><div className="flex items-center justify-between rounded-xl border border-white/[.06] p-4"><span className="text-sm text-slate-400">Pendentes</span><b>{metrics.pending.length}</b></div><div className="flex items-center justify-between rounded-xl border border-white/[.06] p-4"><span className="text-sm text-slate-400">Falhas</span><b>{metrics.failed.length}</b></div></div></div></section>
  </div></main>
}
