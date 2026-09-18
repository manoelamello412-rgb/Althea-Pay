'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CreditCard, MessageSquare, RefreshCw, ShoppingCart, X } from 'lucide-react'
import type { createSupabaseBrowserClient } from '@/lib/supabase/client'

type BrowserDb = ReturnType<typeof createSupabaseBrowserClient>

type Json = Record<string, unknown>

export type Customer360Client = {
  id: string
  data: Json | null
  created_at: string
  user_id: string
}

type SaleRow = { id: string; funnel_id: string | null; amount: number | null; currency: string | null; status: string | null; occurred_at: string | null; created_at: string | null }
type CheckoutRow = { id: string; funnel_id: string | null; amount: number | null; currency: string | null; status: string | null; created_at: string | null }
type ConversationRow = { id: string; funnel_id: string | null; status: string | null; buyer_email: string | null; created_at: string | null; updated_at: string | null }

type TimelineItem = {
  id: string
  kind: 'sale' | 'checkout' | 'conversation'
  title: string
  status: string | null
  funnelId: string | null
  amount: number | null
  currency: string | null
  at: string
}

const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {})
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value))
const pick = (data: Json, keys: string[]) => {
  for (const key of keys) { const value = text(data[key]); if (value) return value }
  for (const parent of ['customer', 'buyer', 'profile']) { const nested = obj(data[parent]); for (const key of keys) { const value = text(nested[key]); if (value) return value } }
  return ''
}
const money = (v: unknown, currency = 'BRL') => (v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(v)))
const escapeLike = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
const dateTime = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d) }
const isApproved = (status: string | null) => ['approved', 'paid', 'completed', 'aprovado', 'pago'].includes((status ?? '').toLowerCase())

const KIND_META: Record<TimelineItem['kind'], { label: string; Icon: typeof ShoppingCart; tint: string }> = {
  sale: { label: 'Venda', Icon: ShoppingCart, tint: 'text-emerald-400' },
  checkout: { label: 'Checkout', Icon: CreditCard, tint: 'text-sky-400' },
  conversation: { label: 'Conversa', Icon: MessageSquare, tint: 'text-violet-400' },
}

export function Customer360Drawer({ client, db, onClose }: { client: Customer360Client; db: BrowserDb; onClose: () => void }) {
  const data = useMemo(() => obj(client.data), [client.data])
  const name = pick(data, ['name', 'full_name', 'nome', 'customer_name']) || 'Cliente sem nome'
  const email = pick(data, ['email', 'buyer_email', 'customer_email'])
  const phone = pick(data, ['phone', 'whatsapp', 'mobile'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [checkouts, setCheckouts] = useState<CheckoutRow[]>([])
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [funnelNames, setFunnelNames] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      if (!email) { setSales([]); setCheckouts([]); setConversations([]); setFunnelNames({}); return }
      const uid = client.user_id
      const like = escapeLike(email)

      const [checkoutRes, salesByEmailRes, conversationRes] = await Promise.all([
        db.from('checkout_sessions').select('id,funnel_id,amount,currency,status,created_at').eq('user_id', uid).ilike('customer->>email', like).order('created_at', { ascending: false }).limit(500),
        db.from('sales').select('id,funnel_id,amount,currency,status,occurred_at,created_at').eq('user_id', uid).ilike('data->>buyer_email', like).order('created_at', { ascending: false }).limit(500),
        db.from('crm_conversations').select('id,funnel_id,status,buyer_email,created_at,updated_at').eq('user_id', uid).ilike('buyer_email', like).order('updated_at', { ascending: false }).limit(500),
      ])
      if (checkoutRes.error) throw checkoutRes.error
      if (salesByEmailRes.error) throw salesByEmailRes.error
      if (conversationRes.error) throw conversationRes.error

      const checkoutRows = (checkoutRes.data ?? []) as CheckoutRow[]
      const salesMap = new Map<string, SaleRow>()
      for (const row of (salesByEmailRes.data ?? []) as SaleRow[]) salesMap.set(row.id, row)

      const checkoutIds = checkoutRows.map((row) => row.id)
      if (checkoutIds.length) {
        const salesByCheckout = await db.from('sales').select('id,funnel_id,amount,currency,status,occurred_at,created_at').eq('user_id', uid).in('checkout_id', checkoutIds).limit(500)
        if (salesByCheckout.error) throw salesByCheckout.error
        for (const row of (salesByCheckout.data ?? []) as SaleRow[]) salesMap.set(row.id, row)
      }

      const salesRows = [...salesMap.values()]
      const conversationRows = (conversationRes.data ?? []) as ConversationRow[]

      const funnelIds = [...new Set([...salesRows, ...checkoutRows, ...conversationRows].map((row) => row.funnel_id).filter((id): id is string => Boolean(id)))]
      let names: Record<string, string> = {}
      if (funnelIds.length) {
        const funnelRes = await db.from('funnels').select('id,nome').in('id', funnelIds)
        if (funnelRes.error) throw funnelRes.error
        names = Object.fromEntries((funnelRes.data ?? []).map((row: { id: string; nome: string | null }) => [row.id, row.nome ?? row.id]))
      }

      setSales(salesRows); setCheckouts(checkoutRows); setConversations(conversationRows); setFunnelNames(names)
    } catch (cause) {
      console.error('[ALTHEA-CUSTOMER360]', cause)
      setError('Não foi possível montar o histórico unificado deste cliente.')
    } finally { setLoading(false) }
  }, [db, client.user_id, email])

  useEffect(() => { void load() }, [load])

  const funnelLabel = useCallback((id: string | null) => (id ? funnelNames[id] ?? id : 'Sem funil'), [funnelNames])

  const totalSpent = useMemo(() => sales.filter((s) => isApproved(s.status)).reduce((sum, s) => sum + (Number(s.amount) || 0), 0), [sales])
  const primaryCurrency = sales.find((s) => s.currency)?.currency ?? checkouts.find((c) => c.currency)?.currency ?? 'BRL'

  const originFunnels = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of [...sales, ...checkouts, ...conversations]) { if (!row.funnel_id) continue; counts.set(row.funnel_id, (counts.get(row.funnel_id) ?? 0) + 1) }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [sales, checkouts, conversations])

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = []
    for (const s of sales) items.push({ id: `sale-${s.id}`, kind: 'sale', title: isApproved(s.status) ? 'Venda aprovada' : `Venda ${text(s.status) || 'registrada'}`, status: s.status, funnelId: s.funnel_id, amount: s.amount, currency: s.currency, at: s.occurred_at || s.created_at || '' })
    for (const c of checkouts) items.push({ id: `checkout-${c.id}`, kind: 'checkout', title: `Checkout ${text(c.status) || 'iniciado'}`, status: c.status, funnelId: c.funnel_id, amount: c.amount, currency: c.currency, at: c.created_at || '' })
    for (const conv of conversations) items.push({ id: `conversation-${conv.id}`, kind: 'conversation', title: `Conversa ${text(conv.status) || 'registrada'}`, status: conv.status, funnelId: conv.funnel_id, amount: null, currency: null, at: conv.updated_at || conv.created_at || '' })
    return items.filter((item) => item.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [sales, checkouts, conversations])

  return (
    <div role="dialog" aria-modal="true" aria-label="Customer 360" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-6" onClick={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0b100e] shadow-2xl md:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-6">
          <div className="min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Customer 360</span>
            <h2 className="mt-1 truncate text-xl font-black text-slate-100">{name}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">{email || 'Sem e-mail'}{phone ? ` • ${phone}` : ''}</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="Recarregar histórico" className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5"><X size={18} /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <article className="rounded-xl border border-white/10 bg-white/[.025] p-4"><span className="text-[10px] uppercase tracking-widest text-slate-500">Total gasto</span><strong className="mt-2 block text-lg font-black text-emerald-400">{money(totalSpent, primaryCurrency)}</strong></article>
            <article className="rounded-xl border border-white/10 bg-white/[.025] p-4"><span className="text-[10px] uppercase tracking-widest text-slate-500">Vendas</span><strong className="mt-2 block text-lg font-black">{sales.length}</strong></article>
            <article className="rounded-xl border border-white/10 bg-white/[.025] p-4"><span className="text-[10px] uppercase tracking-widest text-slate-500">Conversas</span><strong className="mt-2 block text-lg font-black">{conversations.length}</strong></article>
            <article className="rounded-xl border border-white/10 bg-white/[.025] p-4"><span className="text-[10px] uppercase tracking-widest text-slate-500">Funis de origem</span><strong className="mt-2 block text-lg font-black">{originFunnels.length}</strong></article>
          </section>

          {email ? null : <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[.06] p-4 text-sm text-amber-300">Este cliente não tem e-mail cadastrado, então não é possível cruzar vendas e conversas entre operações.</p>}

          {originFunnels.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Funis de origem</h3>
              <div className="flex flex-wrap gap-2">{originFunnels.map(([id, count]) => <span key={id} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-3 py-1.5 text-xs text-slate-300"><span className="truncate max-w-[220px]">{funnelLabel(id)}</span><span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black text-emerald-400">{count}</span></span>)}</div>
            </section>
          )}

          <section className="mt-6">
            <h3 className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500"><Activity size={12} /> Linha do tempo</h3>
            {loading ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center"><RefreshCw size={20} className="animate-spin text-emerald-400" /><p className="text-sm text-slate-500">Montando histórico unificado…</p></div>
            ) : error ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"><X size={20} className="text-red-400" /><p className="text-sm text-slate-500">{error}</p><button type="button" onClick={() => void load()} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Tentar novamente</button></div>
            ) : timeline.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-center"><Activity size={22} className="text-slate-600" /><p className="text-sm text-slate-500">Nenhuma venda, checkout ou conversa vinculada a este cliente ainda.</p></div>
            ) : (
              <ol className="space-y-2">{timeline.map((item) => { const meta = KIND_META[item.kind]; const Icon = meta.Icon; return (
                <li key={item.id} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3">
                  <span className={`shrink-0 rounded-lg bg-white/[.04] p-2 ${meta.tint}`}><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><b className="truncate text-sm text-slate-100">{item.title}</b><span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">{meta.label}</span></div>
                    <p className="truncate pt-0.5 text-[11px] text-slate-500">{funnelLabel(item.funnelId)} • {dateTime(item.at)}</p>
                  </div>
                  {item.amount != null && <span className={`shrink-0 text-sm font-black ${isApproved(item.status) ? 'text-emerald-400' : 'text-slate-300'}`}>{money(item.amount, item.currency ?? primaryCurrency)}</span>}
                </li>
              ) })}</ol>
            )}
          </section>

          <p className="mt-6 rounded-xl border border-white/10 bg-white/[.02] p-4 font-mono text-[11px] text-slate-500">ID: {client.id}</p>
        </div>
      </div>
    </div>
  )
}
