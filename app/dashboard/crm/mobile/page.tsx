'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, CheckCheck, ChevronRight, CircleAlert, Clock3, Copy, ExternalLink, Inbox, MessageCircle, RefreshCw, Search, Send, UserRound, X, Zap } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type CheckoutStatus = 'respondendo_quiz' | 'no_checkout' | 'parado_no_caixa' | 'cartao_recusado' | 'pago'
type Conversation = {
  id: string
  user_id: string
  funnel_id: string | null
  product_id: string | null
  transaction_id: string | null
  buyer_name: string | null
  buyer_email: string | null
  status: string
  assigned_to: string | null
  metadata: Json
  public_token: string | null
  last_message_at: string | null
  unread_count: number
  created_at: string
  updated_at: string
  checkout_status: CheckoutStatus | null
  customer_whatsapp: string | null
  gateway_error_log: string | null
  last_activity_at: string | null
  quiz_answers: Json
}
type Message = { id: string; conversation_id: string; user_id: string; direction: 'inbound' | 'outbound' | 'system'; channel: string; body: string; metadata: Json; created_at: string; client_message_id?: string | null }
type Event = { id: string; transaction_id: string | null; status: string; error_reason: string | null; buyer_email: string | null; buyer_name: string | null; payload: Json; received_at: string }
type Funnel = { id: string; nome: string }
type PaymentLink = { [key: string]: unknown }

const statusMeta: Record<CheckoutStatus, { label: string; className: string }> = {
  respondendo_quiz: { label: 'Respondendo Quiz', className: 'border-violet-400/20 bg-violet-400/10 text-violet-200' },
  no_checkout: { label: 'No checkout', className: 'border-sky-400/20 bg-sky-400/10 text-sky-200' },
  parado_no_caixa: { label: 'Parado no caixa', className: 'border-amber-400/20 bg-amber-400/10 text-amber-200' },
  cartao_recusado: { label: 'Cartão recusado', className: 'border-rose-400/20 bg-rose-400/10 text-rose-200' },
  pago: { label: 'Pago', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' },
}

const safeObject = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null
const pick = (source: Json, keys: string[]) => {
  for (const key of keys) {
    const value = text(source[key])
    if (value) return value
  }
  for (const parent of ['customer', 'buyer', 'lead']) {
    const nested = safeObject(source[parent])
    for (const key of keys) {
      const value = text(nested[key])
      if (value) return value
    }
  }
  return null
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?'
const time = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
const dateTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
const humanKey = (key: string) => key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase())
const money = (value: unknown, currency: unknown) => {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: text(currency) || 'BRL' }).format(amount)
}

export default function CRMChatMobilePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [uid, setUid] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | CheckoutStatus>('all')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')
  const [showProfile, setShowProfile] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState<'prepare' | 'pix' | 'card' | 'payment_link' | 'send' | null>(null)
  const [recovery, setRecovery] = useState<Json | null>(null)
  const [paymentLink, setPaymentLink] = useState<PaymentLink | null>(null)
  const [copied, setCopied] = useState<'url' | 'pix' | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const auth = await supabase.auth.getUser()
    if (auth.error || !auth.data.user) {
      setError('Sessão expirada. Faça login novamente.')
      setLoading(false)
      return
    }
    const id = auth.data.user.id
    setUid(id)
    const [c, m, e, f] = await Promise.all([
      supabase.from('crm_conversations').select('id,user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,assigned_to,metadata,public_token,last_message_at,unread_count,created_at,updated_at,checkout_status,customer_whatsapp,gateway_error_log,last_activity_at,quiz_answers').eq('user_id', id).order('updated_at', { ascending: false }).limit(300),
      supabase.from('crm_messages').select('id,conversation_id,user_id,direction,channel,body,metadata,created_at,client_message_id').eq('user_id', id).order('created_at', { ascending: false }).limit(1500),
      supabase.from('crm_webhook_events').select('id,transaction_id,status,error_reason,buyer_email,buyer_name,payload,received_at').eq('user_id', id).order('received_at', { ascending: false }).limit(500),
      supabase.from('funnels').select('id,nome').eq('user_id', id).is('deleted_at', null),
    ])
    if (c.error) setError(c.error.message); else setConversations((c.data ?? []) as Conversation[])
    if (m.error) setError(value => value || m.error.message); else setMessages((m.data ?? []) as Message[])
    if (e.error) setError(value => value || e.error.message); else setEvents((e.data ?? []) as Event[])
    if (!f.error) setFunnels((f.data ?? []) as Funnel[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!uid) return
    const channel = supabase.channel(`crm-mobile:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations', filter: `user_id=eq.${uid}` }, () => void load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_messages', filter: `user_id=eq.${uid}` }, () => void load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_webhook_events', filter: `user_id=eq.${uid}` }, () => void load(true))
      .subscribe(state => setLive(state === 'SUBSCRIBED'))
    return () => { void supabase.removeChannel(channel) }
  }, [load, supabase, uid])

  const funnelMap = useMemo(() => new Map(funnels.map(funnel => [funnel.id, funnel.nome])), [funnels])
  const latest = useMemo(() => {
    const map = new Map<string, Message>()
    for (const message of messages) if (!map.has(message.conversation_id)) map.set(message.conversation_id, message)
    return map
  }, [messages])
  const eventFor = useCallback((conversation: Conversation) => events.find(event => (conversation.transaction_id && event.transaction_id === conversation.transaction_id) || (conversation.buyer_email && event.buyer_email?.toLowerCase() === conversation.buyer_email.toLowerCase())) ?? null, [events])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter(conversation => {
      const matchesStatus = filter === 'all' || conversation.checkout_status === filter
      const last = latest.get(conversation.id)
      const haystack = `${conversation.buyer_name ?? ''} ${conversation.buyer_email ?? ''} ${conversation.customer_whatsapp ?? ''} ${last?.body ?? ''} ${funnelMap.get(conversation.funnel_id ?? '') ?? ''}`.toLowerCase()
      return matchesStatus && (!q || haystack.includes(q))
    })
  }, [conversations, filter, funnelMap, latest, query])
  const selected = useMemo(() => conversations.find(conversation => conversation.id === selectedId) ?? null, [conversations, selectedId])
  const selectedEvent = selected ? eventFor(selected) : null
  const selectedMessages = useMemo(() => selected ? messages.filter(message => message.conversation_id === selected.id).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) : [], [messages, selected])
  const profile = useMemo(() => {
    const source = { ...safeObject(selected?.metadata), ...safeObject(selectedEvent?.payload), ...safeObject(selected?.quiz_answers) }
    return {
      name: selected?.buyer_name || selectedEvent?.buyer_name || pick(source, ['name', 'nome', 'full_name', 'customer_name']) || 'Cliente',
      email: selected?.buyer_email || selectedEvent?.buyer_email || pick(source, ['email', 'buyer_email', 'customer_email']),
      whatsapp: selected?.customer_whatsapp || pick(source, ['whatsapp', 'phone', 'telephone', 'mobile']),
      origin: pick(source, ['origin', 'source', 'utm_source']),
      campaign: pick(source, ['utm_campaign', 'campaign']),
      funnel: selected?.funnel_id ? funnelMap.get(selected.funnel_id) ?? selected.funnel_id : pick(source, ['funnel_name', 'funnel']),
    }
  }, [funnelMap, selected, selectedEvent])
  const quizEntries = useMemo(() => Object.entries(safeObject(selected?.quiz_answers)).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== ''), [selected])

  useEffect(() => {
    if (!selected || selected.unread_count <= 0 || !uid) return
    void supabase.from('crm_conversations').update({ unread_count: 0 }).eq('id', selected.id).eq('user_id', uid)
  }, [selected, supabase, uid])

  useEffect(() => {
    if (!selectedId) {
      setRecovery(null)
      setPaymentLink(null)
      setCopied(null)
    }
  }, [selectedId])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!selected || !body || sending || selected.status === 'closed') return
    setSending(true)
    setError('')
    try {
      const result = await supabase.rpc('crm_operator_send_message', { p_conversation_id: selected.id, p_body: body, p_client_message_id: `${crypto.randomUUID()}-${Date.now()}` })
      if (result.error || !result.data) throw result.error ?? new Error('Mensagem não enviada.')
      setDraft('')
      const row = result.data as unknown as Message
      setMessages(current => current.some(message => message.id === row.id) ? current : [...current, row])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao enviar mensagem.')
    } finally {
      setSending(false)
    }
  }

  async function setStatus(status: 'open' | 'pending' | 'closed') {
    if (!selected) return
    const result = await supabase.rpc('crm_operator_set_status', { p_conversation_id: selected.id, p_status: status })
    if (result.error) { setError(result.error.message); return }
    setConversations(current => current.map(conversation => conversation.id === selected.id ? { ...conversation, status } : conversation))
  }

  async function commercialAction(kind: 'prepare' | 'pix' | 'card' | 'payment_link') {
    if (!selected || selected.checkout_status === 'pago' || recoveryLoading) return
    setRecoveryLoading(kind)
    setError('')
    try {
      const action = kind === 'prepare' ? 'prepare' : 'payment_link'
      const linkType = kind === 'pix' ? 'pix' : kind === 'card' ? 'card' : 'payment_link'
      const response = await fetch('/api/crm/checkout-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selected.id, action, linkType, idempotencyKey: `crm-recovery:${selected.id}:${linkType}` }),
      })
      const payload = await response.json().catch(() => ({})) as Json
      if (!response.ok) throw new Error(text(payload.error) || 'Não foi possível recuperar o checkout.')
      if (payload.recovery) setRecovery(safeObject(payload.recovery))
      if (payload.paymentLink) setPaymentLink(safeObject(payload.paymentLink))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha na operação comercial.')
    } finally {
      setRecoveryLoading(null)
    }
  }

  async function copyValue(value: string, type: 'url' | 'pix') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(type)
      window.setTimeout(() => setCopied(current => current === type ? null : current), 1800)
    } catch {
      setError('Não foi possível copiar para a área de transferência.')
    }
  }

  async function sendPaymentLink() {
    if (!selected || !paymentLink || recoveryLoading) return
    const url = pick(paymentLink, ['payment_url', 'paymentUrl', 'url', 'checkout_url', 'checkoutUrl'])
    const pix = pick(paymentLink, ['pix_copy_paste', 'pixCopyPaste', 'pix', 'copy_paste'])
    const body = url ? `Segue o link para finalizar seu pagamento: ${url}` : pix ? `Segue o PIX para finalizar seu pagamento:\n${pix}` : ''
    if (!body) { setError('O gateway não retornou um link ou PIX utilizável.'); return }
    setRecoveryLoading('send')
    setError('')
    try {
      const result = await supabase.rpc('crm_operator_send_message', { p_conversation_id: selected.id, p_body: body, p_client_message_id: `${crypto.randomUUID()}-${Date.now()}` })
      if (result.error || !result.data) throw result.error ?? new Error('Pagamento não enviado pelo chat.')
      const row = result.data as unknown as Message
      setMessages(current => current.some(message => message.id === row.id) ? current : [...current, row])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao enviar o pagamento no chat.')
    } finally {
      setRecoveryLoading(null)
    }
  }

  const status = selected?.checkout_status ? statusMeta[selected.checkout_status] : null
  const paymentUrl = paymentLink ? pick(paymentLink, ['payment_url', 'paymentUrl', 'url', 'checkout_url', 'checkoutUrl']) : null
  const pixCopyPaste = paymentLink ? pick(paymentLink, ['pix_copy_paste', 'pixCopyPaste', 'pix', 'copy_paste']) : null
  const qrCode = paymentLink ? pick(paymentLink, ['qr_code_base64', 'qrCodeBase64', 'qr_code', 'qrCode']) : null
  const paymentStatus = paymentLink ? pick(paymentLink, ['status', 'payment_status']) : null
  const paymentExpires = paymentLink ? pick(paymentLink, ['expires_at', 'expiresAt']) : null
  const recoveryAmount = recovery ? recovery.amount ?? recovery.value : null
  const recoveryCurrency = recovery ? recovery.currency : 'BRL'
  const commercialBlocked = selected?.checkout_status === 'pago'

  if (selected) {
    return (
      <div className="min-h-screen bg-[#070A09] pb-32 text-slate-100">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070A09]/95 backdrop-blur-xl"><div className="flex h-16 items-center gap-3 px-3"><button onClick={() => setSelectedId(null)} aria-label="Voltar para conversas" className="rounded-xl border border-white/10 p-2 text-slate-300"><ArrowLeft size={18} /></button><div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[.06] text-[10px] font-black">{initials(profile.name)}</div><div className="min-w-0"><div className="truncate text-sm font-black">{profile.name}</div><div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500"><i className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-[#1DB854]' : 'bg-amber-400'}`} />{live ? 'online' : 'reconectando'}</div></div></div><button onClick={() => setShowProfile(true)} aria-label="Abrir perfil e Quiz" className="rounded-xl border border-white/10 p-2 text-slate-300"><UserRound size={17} /></button></div></header>
        <main className="px-3 pt-3">
          <div className="flex gap-2 overflow-x-auto pb-2">{status && <span className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-bold ${status.className}`}>{status.label}</span>}<span className="whitespace-nowrap rounded-full border border-white/10 bg-white/[.03] px-3 py-1.5 text-[10px] text-slate-400">{funnelMap.get(selected.funnel_id ?? '') ?? 'Funil não identificado'}</span>{selected.gateway_error_log && <span className="whitespace-nowrap rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-[10px] text-rose-200">Gateway com erro</span>}</div>
          {selected.gateway_error_log && <div className="mb-3 flex gap-2 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-100"><CircleAlert size={16} className="mt-0.5 shrink-0" /><div><b>Última recusa do gateway</b><p className="mt-1 text-rose-200/80">{selected.gateway_error_log}</p></div></div>}
          <section className="mb-4 rounded-[24px] border border-white/[.08] bg-[#0B0F0D] p-3 shadow-xl">
            <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.2em] text-[#1DB854]"><Zap size={12} /> Recuperação comercial</div><div className="mt-1 text-sm font-black">Recuperar o checkout deste lead</div><div className="mt-1 text-[10px] text-slate-600">A origem financeira é o checkout real. O CRM não usa valor informado pelo navegador.</div></div>{recoveryAmount && <span className="shrink-0 rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1.5 text-[10px] font-black text-slate-200">{money(recoveryAmount, recoveryCurrency)}</span>}</div>
            {commercialBlocked ? <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-200">Checkout já pago. As ações comerciais permanecem bloqueadas para evitar cobrança duplicada.</div> : <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => void commercialAction('prepare')} disabled={recoveryLoading !== null} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-3 py-3 text-[10px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-40"><RefreshCw size={14} className={recoveryLoading === 'prepare' ? 'animate-spin' : ''} /> Recuperar</button><button onClick={() => void commercialAction('pix')} disabled={recoveryLoading !== null} className="flex items-center justify-center gap-2 rounded-xl border border-[#1DB854]/30 bg-[#12351F] px-3 py-3 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-40"><Zap size={14} /> {recoveryLoading === 'pix' ? 'Gerando…' : 'Gerar PIX'}</button><button onClick={() => void commercialAction('card')} disabled={recoveryLoading !== null} className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-violet-200 disabled:opacity-40"><ExternalLink size={14} /> {recoveryLoading === 'card' ? 'Gerando…' : 'Gerar cartão'}</button><button onClick={() => void commercialAction('payment_link')} disabled={recoveryLoading !== null} className="flex items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-sky-200 disabled:opacity-40"><ExternalLink size={14} /> {recoveryLoading === 'payment_link' ? 'Gerando…' : 'Gerar link'}</button></div>}
            {recovery && <div className="mt-3 rounded-2xl border border-white/[.07] bg-white/[.02] p-3"><div className="flex items-center justify-between gap-2"><div className="text-[9px] font-black uppercase tracking-wider text-slate-600">Checkout reconciliado</div><div className="text-[10px] text-slate-400">{money(recoveryAmount, recoveryCurrency)}</div></div><div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-slate-600">Checkout</span><div className="mt-0.5 break-all text-slate-300">{text(recovery.checkout_id) || '—'}</div></div><div><span className="text-slate-600">Funil</span><div className="mt-0.5 break-all text-slate-300">{text(recovery.funnel_id) || '—'}</div></div></div></div>}
            {paymentLink && <div className="mt-3 rounded-2xl border border-[#1DB854]/20 bg-[#0D1811] p-3"><div className="flex items-center justify-between gap-2"><div className="text-[9px] font-black uppercase tracking-[.18em] text-[#1DB854]">Pagamento preparado</div><span className="rounded-full border border-white/10 px-2 py-1 text-[9px] uppercase text-slate-500">{paymentStatus || 'ready'}</span></div>{paymentUrl && <div className="mt-3"><div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">Link de pagamento</div><div className="flex gap-2"><div className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-slate-300">{paymentUrl}</div><button onClick={() => void copyValue(paymentUrl, 'url')} aria-label="Copiar link de pagamento" className="rounded-xl border border-white/10 px-3 text-slate-300"><Copy size={14} /></button></div><div className="mt-1 text-[9px] text-slate-600">{copied === 'url' ? 'Copiado.' : paymentExpires ? `Expira em ${dateTime(paymentExpires)}` : 'Validade informada pelo gateway.'}</div></div>}{pixCopyPaste && <div className="mt-3"><div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">PIX copia e cola</div><div className="flex gap-2"><div className="max-h-20 min-w-0 flex-1 overflow-y-auto break-all rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-[10px] leading-4 text-slate-300">{pixCopyPaste}</div><button onClick={() => void copyValue(pixCopyPaste, 'pix')} aria-label="Copiar PIX" className="rounded-xl border border-white/10 px-3 text-slate-300"><Copy size={14} /></button></div><div className="mt-1 text-[9px] text-slate-600">{copied === 'pix' ? 'Copiado.' : 'Código retornado pelo gateway.'}</div></div>}{qrCode && qrCode.startsWith('data:image/') && <img src={qrCode} alt="QR Code PIX" className="mx-auto mt-3 h-44 w-44 rounded-2xl bg-white p-2" />}{(paymentUrl || pixCopyPaste) && <button onClick={() => void sendPaymentLink()} disabled={recoveryLoading !== null} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB854] px-3 py-3 text-[10px] font-black uppercase tracking-wider text-black disabled:opacity-40"><Send size={14} /> {recoveryLoading === 'send' ? 'Enviando…' : 'Enviar pelo chat'}</button>}</div>}
          </section>
          <section className="space-y-3 pb-5">{selectedMessages.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/[.02] p-8 text-center text-sm text-slate-500">Nenhuma mensagem ainda.</div> : selectedMessages.map(message => { const mine = message.direction === 'outbound'; return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${mine ? 'rounded-br-md bg-[#12351F] text-white' : message.direction === 'system' ? 'border border-white/10 bg-white/[.03] text-slate-400' : 'rounded-bl-md bg-[#151A17] text-slate-200'}`}><div>{message.body}</div><div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-500">{time(message.created_at)} {mine && (message.client_message_id ? <CheckCheck size={11} /> : <Check size={11} />)}</div></div></div> })}</section>
        </main>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#080B0A]/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl"><form onSubmit={sendMessage} className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-white/10 bg-white/[.03] p-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} rows={1} disabled={selected.status === 'closed' || sending} placeholder={selected.status === 'closed' ? 'Conversa encerrada' : 'Escreva uma mensagem...'} className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-600" /><button disabled={!draft.trim() || sending || selected.status === 'closed'} aria-label="Enviar mensagem" className="rounded-xl bg-[#1DB854] p-3 text-black disabled:cursor-not-allowed disabled:opacity-30"><Send size={17} /></button></form><div className="mx-auto mt-2 flex max-w-3xl justify-center gap-2"><button onClick={() => void setStatus('open')} className="rounded-full border border-white/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Abrir</button><button onClick={() => void setStatus('pending')} className="rounded-full border border-amber-400/20 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">Pendente</button><button onClick={() => void setStatus('closed')} className="rounded-full border border-white/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Encerrar</button></div></div>
        {showProfile && <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={() => setShowProfile(false)}><aside onClick={event => event.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#0B0F0D] p-4 pb-10 shadow-2xl"><div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/10" /><div className="mb-5 flex items-start justify-between"><div><div className="text-[9px] font-black uppercase tracking-[.2em] text-[#1DB854]">Contexto do lead</div><h2 className="mt-1 text-xl font-black">{profile.name}</h2></div><button onClick={() => setShowProfile(false)} aria-label="Fechar perfil" className="rounded-xl border border-white/10 p-2 text-slate-400"><X size={17} /></button></div><div className="grid grid-cols-2 gap-2">{[['WhatsApp', profile.whatsapp], ['E-mail', profile.email], ['Origem', profile.origin], ['Campanha', profile.campaign], ['Funil', profile.funnel], ['Atividade', dateTime(selected.last_activity_at)]].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 break-words text-xs text-slate-200">{value || 'Não informado'}</div></div>)}</div><div className="mt-5"><div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.18em] text-slate-500"><MessageCircle size={13} /> Histórico do Quiz</div>{quizEntries.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-600">Nenhuma resposta de Quiz registrada nesta sessão.</div> : <div className="space-y-2">{quizEntries.map(([key, value]) => <div key={key} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{humanKey(key)}</div><div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</div></div>)}</div>}</div>{selectedEvent && <div className="mt-5 rounded-2xl border border-white/[.07] bg-white/[.02] p-3"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-600"><Clock3 size={13} /> Último evento financeiro</div><div className="mt-2 text-sm font-bold">{selectedEvent.status}</div><div className="mt-1 text-[10px] text-slate-500">{dateTime(selectedEvent.received_at)}{selectedEvent.error_reason ? ` · ${selectedEvent.error_reason}` : ''}</div></div>}</aside></div>}
      </div>
    )
  }

  return <div className="min-h-screen bg-[#070A09] pb-32 text-slate-100"><header className="sticky top-0 z-40 border-b border-white/10 bg-[#070A09]/95 backdrop-blur-xl"><div className="px-3 py-3"><div className="flex items-center justify-between"><div><div className="text-sm font-black tracking-[.18em]">ALTHEA PAY <span className="text-[#1DB854]">// CHAT</span></div><div className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-600"><i className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-[#1DB854]' : 'bg-amber-400'}`} />{live ? 'Realtime ativo' : 'Conectando'}</div></div><button onClick={() => void load()} aria-label="Atualizar" className="rounded-xl border border-white/10 p-2.5 text-slate-400"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button></div><div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.03] px-3 py-2.5"><Search size={15} className="text-slate-600" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cliente, mensagem ou funil..." className="w-full bg-transparent text-xs outline-none placeholder:text-slate-600" /></div></div></header><main className="px-3 pt-4"><div className="mb-3 flex items-center gap-2 text-[9px] font-black uppercase tracking-[.2em] text-[#1DB854]"><Zap size={12} /> Central operacional</div><div className="mb-3 flex gap-2 overflow-x-auto pb-1"><button onClick={() => setFilter('all')} className={`whitespace-nowrap rounded-full border px-3 py-2 text-[10px] font-bold ${filter === 'all' ? 'border-[#1DB854]/40 bg-[#12351F] text-white' : 'border-white/10 text-slate-500'}`}>Todas <span className="ml-1 opacity-50">{conversations.length}</span></button>{(Object.keys(statusMeta) as CheckoutStatus[]).map(key => <button key={key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-full border px-3 py-2 text-[10px] font-bold ${filter === key ? statusMeta[key].className : 'border-white/10 text-slate-500'}`}>{statusMeta[key].label}</button>)}</div>{error && <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-100"><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}{loading ? <div className="space-y-2">{[1, 2, 3, 4, 5, 6].map(index => <div key={index} className="h-20 animate-pulse rounded-2xl border border-white/[.04] bg-white/[.025]" />)}</div> : filtered.length === 0 ? <div className="rounded-[24px] border border-dashed border-white/10 px-6 py-14 text-center"><Inbox className="mx-auto mb-3 text-slate-700" size={30} /><div className="text-sm font-bold text-slate-400">Nenhum atendimento encontrado</div><p className="mt-1 text-xs text-slate-600">A fila é alimentada pelos eventos reais dos funis e do checkout.</p></div> : <div className="space-y-2">{filtered.map(conversation => { const name = conversation.buyer_name || conversation.buyer_email || conversation.customer_whatsapp || 'Cliente sem identificação'; const last = latest.get(conversation.id); const status = conversation.checkout_status ? statusMeta[conversation.checkout_status] : null; return <button key={conversation.id} onClick={() => setSelectedId(conversation.id)} className="w-full rounded-2xl border border-white/[.07] bg-[#0B0F0D] p-3 text-left active:scale-[.99]"><div className="flex items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[.05] text-xs font-black">{initials(name)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-sm">{name}</strong><span className="text-[9px] text-slate-600">{time(conversation.last_message_at || conversation.updated_at)}</span></div><div className="mt-1 truncate text-xs text-slate-500">{last?.body || 'Sessão de atendimento iniciada.'}</div><div className="mt-2 flex items-center gap-1.5 overflow-hidden">{status && <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-bold ${status.className}`}>{status.label}</span>}{conversation.funnel_id && <span className="truncate rounded-full border border-white/10 px-2 py-1 text-[8px] text-slate-600">{funnelMap.get(conversation.funnel_id) || conversation.funnel_id}</span>}{conversation.unread_count > 0 && <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1DB854] px-1 text-[9px] font-black text-black">{conversation.unread_count}</span>}</div></div><ChevronRight size={16} className="shrink-0 text-slate-700" /></div></button> })}</div>}</main></div>
}
