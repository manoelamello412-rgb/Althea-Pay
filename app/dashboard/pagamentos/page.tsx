'use client'

import { AlertTriangle, CheckCircle2, Clock3, CreditCard, RefreshCw, Search, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type PaymentStatus = 'created' | 'pending' | 'approved' | 'failed' | 'refunded' | 'chargeback'

type Payment = {
  id: string
  user_id: string
  funnel_id: string | null
  product_id: string | null
  gateway_id: string | null
  external_id: string | null
  amount: number
  currency: string
  status: PaymentStatus
  customer: Record<string, unknown>
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

const statusLabel: Record<PaymentStatus, string> = { created: 'Criada', pending: 'Pendente', approved: 'Aprovada', failed: 'Falhou', refunded: 'Reembolsada', chargeback: 'Chargeback' }
const statusClass: Record<PaymentStatus, string> = { created: 'bg-white/5 text-white/60', pending: 'bg-amber-400/10 text-amber-300', approved: 'bg-emerald-400/10 text-emerald-300', failed: 'bg-red-400/10 text-red-300', refunded: 'bg-sky-400/10 text-sky-300', chargeback: 'bg-fuchsia-400/10 text-fuchsia-300' }
const iconFor = (status: PaymentStatus) => status === 'approved' ? CheckCircle2 : status === 'pending' || status === 'created' ? Clock3 : status === 'failed' ? XCircle : AlertTriangle
const money = (amount: number, currency: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(Number(amount) || 0)
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
const customerText = (customer: Record<string, unknown>) => String(customer.name || customer.full_name || customer.email || customer.phone || 'Cliente não identificado')

export default function PagamentosPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payments, setPayments] = useState<Payment[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | PaymentStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Payment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setPayments([]); return }
      const result = await db.from('gateway_transactions').select('id,user_id,funnel_id,product_id,gateway_id,external_id,amount,currency,status,customer,error_message,created_at,updated_at,completed_at').order('created_at', { ascending: false }).limit(5000)
      if (result.error) throw result.error
      setPayments((result.data || []) as Payment[])
    } catch (cause) {
      console.error('[ALTHEA-PAGAMENTOS]', cause); setError('Não foi possível carregar os pagamentos reais.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let channel: ReturnType<typeof db.channel> | null = null; let cancelled = false
    const subscribe = async () => { const { data: auth } = await db.auth.getUser(); if (cancelled || !auth.user) return; channel = db.channel(`payments-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'gateway_transactions', filter: `user_id=eq.${auth.user.id}` }, () => void load()).subscribe() }
    void subscribe(); return () => { cancelled = true; if (channel) void db.removeChannel(channel) }
  }, [db, load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return payments.filter((payment) => {
      if (status !== 'all' && payment.status !== status) return false
      if (!needle) return true
      return [payment.id, payment.external_id, payment.gateway_id, payment.funnel_id, payment.product_id, customerText(payment.customer)].filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [payments, query, status])

  const metrics = useMemo(() => {
    const currencies = [...new Set(payments.map((payment) => payment.currency?.trim().toUpperCase() || 'BRL'))]
    return {
      total: currencies.length === 1 ? payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) : null,
      currency: currencies[0] || 'BRL',
      currencyCount: currencies.length,
      approved: payments.filter((payment) => payment.status === 'approved').length,
      pending: payments.filter((payment) => payment.status === 'pending').length,
      exceptions: payments.filter((payment) => ['failed', 'chargeback'].includes(payment.status)).length,
    }
  }, [payments])

  return <main className="min-h-screen bg-[#070809] px-4 py-6 text-white md:px-8 lg:px-10"><div className="mx-auto w-full max-w-[1500px] space-y-6">
    <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-300/80">Operação financeira</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Pagamentos</h1><p className="mt-1 text-sm text-white/50">Acompanhamento operacional das transações processadas pelos gateways externos.</p></div><button type="button" onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/[0.08]"><RefreshCw size={15} /> Sincronizar</button></header>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Volume carregado', metrics.total == null ? `${metrics.currencyCount} moedas` : money(metrics.total, metrics.currency)], ['Aprovados', String(metrics.approved)], ['Pendentes', String(metrics.pending)], ['Exceções', String(metrics.exceptions)]].map(([label, value]) => <article key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><p className="text-xs uppercase tracking-wider text-white/40">{label}</p><strong className="mt-2 block text-2xl font-semibold">{value}</strong></article>)}</section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 md:p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white/50 lg:max-w-xl"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por cliente, transação, gateway ou funil..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25" /></label><div className="flex gap-2 overflow-x-auto pb-1">{(['all', 'approved', 'pending', 'failed', 'refunded', 'chargeback'] as const).map((item) => <button key={item} type="button" onClick={() => setStatus(item)} className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs transition ${status === item ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-white/45 hover:bg-white/5'}`}>{item === 'all' ? 'Todos' : statusLabel[item]}</button>)}</div></div>
      <div className="mt-5 overflow-x-auto">{loading ? <div className="flex min-h-56 items-center justify-center text-sm text-white/40">Sincronizando pagamentos reais...</div> : error ? <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"><XCircle className="text-red-300" size={24} /><p className="text-sm text-white/60">{error}</p><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70">Tentar novamente</button></div> : filtered.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><CreditCard className="text-white/25" size={25} /><strong className="text-sm text-white/65">Nenhum pagamento encontrado</strong><p className="text-xs text-white/35">Os dados aparecerão aqui quando transações reais forem recebidas.</p></div> : <table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/30"><th className="px-3 py-3 font-medium">Cliente</th><th className="px-3 py-3 font-medium">Valor</th><th className="px-3 py-3 font-medium">Gateway</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Atualizado</th><th className="px-3 py-3" /></tr></thead><tbody>{filtered.map((payment) => { const Icon = iconFor(payment.status); return <tr key={payment.id} className="border-b border-white/[0.06] transition hover:bg-white/[0.025]"><td className="px-3 py-4"><button type="button" onClick={() => setSelected(payment)} className="text-left"><strong className="block text-white/85">{customerText(payment.customer)}</strong><span className="mt-1 block max-w-[280px] truncate text-xs text-white/30">{payment.external_id || payment.id}</span></button></td><td className="px-3 py-4 font-medium text-white/80">{money(Number(payment.amount), payment.currency)}</td><td className="px-3 py-4 text-white/55">{payment.gateway_id || 'Não informado'}</td><td className="px-3 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${statusClass[payment.status]}`}><Icon size={13} />{statusLabel[payment.status]}</span></td><td className="px-3 py-4 text-white/40">{dateTime(payment.updated_at || payment.created_at)}</td><td className="px-3 py-4 text-right"><button type="button" onClick={() => setSelected(payment)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 hover:bg-white/5">Detalhes</button></td></tr>})}</tbody></table>}</div>
    </section>
  </div>{selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6" role="dialog" aria-modal="true" onClick={(event) => { if (event.currentTarget === event.target) setSelected(null) }}><section className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-[#0c0f10] p-6 shadow-2xl md:rounded-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wider text-white/35">Transação</p><h2 className="mt-1 text-xl font-semibold">{customerText(selected.customer)}</h2></div><button type="button" aria-label="Fechar" onClick={() => setSelected(null)} className="rounded-lg p-2 text-white/50 hover:bg-white/5"><XCircle size={19} /></button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{[['Status', statusLabel[selected.status]], ['Valor', money(Number(selected.amount), selected.currency)], ['Gateway', selected.gateway_id || 'Não informado'], ['Criada em', dateTime(selected.created_at)], ['ID interno', selected.id]].map(([label, value], index) => <div key={label} className={`rounded-xl bg-white/[0.04] p-4 ${index === 4 ? 'sm:col-span-2' : ''}`}><span className="text-xs text-white/35">{label}</span><strong className="mt-1 block break-all text-sm">{value}</strong></div>)}{selected.error_message && <div className="rounded-xl bg-red-400/5 p-4 sm:col-span-2"><span className="text-xs text-red-300/60">Falha reportada</span><p className="mt-1 text-sm text-red-200/80">{selected.error_message}</p></div>}</div><button type="button" onClick={() => setSelected(null)} className="mt-5 w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-medium text-white hover:bg-white/15">Fechar</button></section></div>}</main>
}
