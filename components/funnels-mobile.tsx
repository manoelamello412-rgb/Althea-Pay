'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, GitBranch, MessageCircle, Search, Send, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Funnel = { id: string; name: string; status?: string | null }
type Conversation = {
  id: string
  funnel_id?: string | null
  buyer_name?: string | null
  buyer_email?: string | null
  transaction_id?: string | null
  status?: string | null
  updated_at?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}
type CrmMessage = { id: string; conversation_id: string; user_id: string; direction: 'inbound' | 'outbound' | 'system'; channel?: string | null; body: string; created_at: string }

const spring = { type: 'spring' as const, stiffness: 420, damping: 32, mass: .72 }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return value == null ? null : String(value)
  const clean = value.trim()
  return clean || null
}
function firstText(...values: unknown[]): string | null {
  for (const value of values) { const text = textValue(value); if (text) return text }
  return null
}
function metadataFor(conversation: Conversation) {
  const root = objectValue(conversation.metadata)
  const customer = objectValue(root.customer)
  const lead = objectValue(root.lead)
  const answers = objectValue(root.quiz_answers ?? root.quizAnswers ?? root.answers)
  const tracking = objectValue(root.tracking ?? root.attribution)
  const phone = firstText(customer.phone, lead.phone, root.phone, root.telefone)
  const source = firstText(tracking.source, tracking.utm_source, root.source, root.origin, root.origem)
  const notes = firstText(root.notes, root.note, root.internal_notes, root.admin_notes)
  const name = firstText(conversation.buyer_name, customer.name, lead.name, root.name)
  const email = firstText(conversation.buyer_email, customer.email, lead.email, root.email)
  const quizEntries = Object.entries(answers).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
  return { root, customer, lead, phone, source, notes, name, email, quizEntries }
}

export default function FunnelsMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [active, setActive] = useState('funis')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'Todas' | 'Não lidas' | 'Funis'>('Todas')
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [chats, setChats] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<CrmMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handler = (event: Event) => setActive((event as CustomEvent<string>).detail || 'dashboard')
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  useEffect(() => {
    let cancelled = false
    let conversationChannel: ReturnType<typeof db.channel> | null = null
    let messageChannel: ReturnType<typeof db.channel> | null = null
    const load = async () => {
      setLoading(true); setError('')
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { setLoading(false); setError('Sessão expirada.'); return }
      const [funnelResult, conversationResult] = await Promise.all([
        db.from('funnels').select('id,nome,status').eq('user_id', auth.user.id).is('deleted_at', null),
        db.from('crm_conversations').select('id,funnel_id,buyer_name,buyer_email,transaction_id,status,updated_at,created_at,metadata').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(200),
      ])
      if (cancelled) return
      if (funnelResult.error || conversationResult.error) { setError(funnelResult.error?.message || conversationResult.error?.message || 'Não foi possível carregar o CRM.'); setLoading(false); return }
      setFunnels((funnelResult.data ?? []).map((f) => ({ id: String(f.id), name: textValue(f.nome) || 'Funil sem nome', status: textValue(f.status) })))
      setChats((conversationResult.data ?? []) as Conversation[])
      setLoading(false)
      const refresh = async () => {
        const result = await db.from('crm_conversations').select('id,funnel_id,buyer_name,buyer_email,transaction_id,status,updated_at,created_at,metadata').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(200)
        if (!result.error) setChats((result.data ?? []) as Conversation[])
      }
      conversationChannel = db.channel(`crm-chat-conversations-${auth.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations', filter: `user_id=eq.${auth.user.id}` }, (payload) => {
        const row = payload.new as Conversation
        if (payload.eventType === 'DELETE') { setChats((current) => current.filter((item) => item.id !== (payload.old as Conversation).id)); return }
        setChats((current) => [row, ...current.filter((item) => item.id !== row.id)].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))))
      }).subscribe()
      messageChannel = db.channel(`crm-chat-messages-${auth.user.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_messages', filter: `user_id=eq.${auth.user.id}` }, (payload) => {
        const incoming = payload.new as CrmMessage
        if (selected?.id === incoming.conversation_id) setMessages((current) => current.some((m) => m.id === incoming.id) ? current : [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at)))
        void refresh()
      }).subscribe()
    }
    void load()
    return () => { cancelled = true; if (conversationChannel) void db.removeChannel(conversationChannel); if (messageChannel) void db.removeChannel(messageChannel) }
  }, [db, selected?.id])

  useEffect(() => {
    let cancelled = false
    if (!selected) { setMessages([]); return }
    setMessagesLoading(true)
    void db.from('crm_messages').select('id,conversation_id,user_id,direction,channel,body,created_at').eq('conversation_id', selected.id).order('created_at', { ascending: true }).limit(500).then((result) => { if (!cancelled) { setMessages(result.error ? [] : (result.data ?? []) as CrmMessage[]); setMessagesLoading(false) } })
    return () => { cancelled = true }
  }, [db, selected?.id])

  const funnelById = useMemo(() => new Map(funnels.map((f) => [f.id, f])), [funnels])
  const funnelName = (conversation: Conversation) => funnelById.get(conversation.funnel_id || '')?.name || textValue(objectValue(conversation.metadata).funnel_name) || 'Funil não identificado'
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return chats.filter((c) => {
      const meta = metadataFor(c)
      const searchable = [meta.name, meta.email, meta.phone, meta.source, c.transaction_id, funnelName(c)].filter(Boolean).join(' ').toLowerCase()
      return (tab === 'Todas' || (tab === 'Não lidas' && c.status === 'unread') || (tab === 'Funis' && !!c.funnel_id)) && (!q || searchable.includes(q))
    })
  }, [chats, query, tab, funnelById])

  async function sendMessage() {
    if (!selected || !draft.trim() || sending) return
    setSending(true); setError('')
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) { setError('Sessão expirada.'); setSending(false); return }
    const body = draft.trim()
    const result = await db.from('crm_messages').insert({ conversation_id: selected.id, user_id: auth.user.id, direction: 'outbound', channel: 'funnel_chat', body }).select('id,conversation_id,user_id,direction,channel,body,created_at').single()
    if (result.error) setError(`Mensagem não enviada: ${result.error.message}`)
    else { setDraft(''); setMessages((current) => current.some((m) => m.id === result.data.id) ? current : [...current, result.data as CrmMessage]) }
    setSending(false)
  }

  const go = (page: string) => { setActive(page); window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: page })) }
  if (active !== 'funis') return null

  return (
    <section className="min-h-full w-full bg-[#070708] text-white pb-8">
      <div className="mx-auto max-w-[1500px] px-3 py-3 sm:px-5 lg:px-7">
        <header className="mb-4 flex items-center justify-between lg:mb-6">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#1DB854]">Live CRM</p><h1 className="mt-1 text-xl font-black tracking-tight sm:text-2xl">Conversas & Funis</h1><p className="mt-1 text-xs text-slate-500">Atendimentos espelhados dos funis conectados.</p></div>
          <div className="flex items-center gap-2 rounded-xl bg-[#0E1110] px-3 py-2 text-[11px] font-semibold text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-[#1DB854] shadow-[0_0_10px_#1DB854]" /> Ao vivo</div>
        </header>

        <div className="mb-4 grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)_330px] lg:items-stretch">
          <aside className="rounded-2xl bg-[#0E1110] p-3 lg:min-h-[calc(100vh-150px)]">
            <div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-[0.18em] text-slate-500">INBOX</p><p className="text-sm font-bold">Conversas</p></div><span className="rounded-lg bg-[#070708] px-2 py-1 text-[10px] text-slate-400">{filtered.length}</span></div>
            <label className="mb-3 flex h-10 items-center gap-2 rounded-xl bg-[#070708] px-3 text-slate-500"><Search size={15}/><input className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-600" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar lead, e-mail, telefone..."/></label>
            <div className="mb-3 flex gap-1 rounded-xl bg-[#070708] p-1">{(['Todas','Não lidas','Funis'] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-bold ${tab === item ? 'bg-[#0E1110] text-white' : 'text-slate-500'}`}>{item}</button>)}</div>
            <div className="max-h-[56vh] space-y-1.5 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-310px)]">
              {loading ? <div className="space-y-2 p-3 text-xs text-slate-500">Carregando atendimentos...</div> : filtered.length === 0 ? <div className="rounded-xl bg-[#070708] p-5 text-center text-xs text-slate-600">Nenhuma conversa recebida.</div> : filtered.map((conversation) => { const meta = metadataFor(conversation); return <button key={conversation.id} type="button" onClick={() => setSelected(conversation)} className={`w-full rounded-xl p-3 text-left transition ${selected?.id === conversation.id ? 'bg-[#070708]' : 'bg-transparent hover:bg-[#070708]'}`}><div className="flex gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#070708] text-xs font-black text-[#1DB854]">{(meta.name || 'C').slice(0,1).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{meta.name || 'Cliente'}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{meta.email || meta.phone || 'Contato do funil'}</span><span className="mt-1 flex items-center gap-1 truncate text-[9px] text-slate-600"><GitBranch size={10}/> {funnelName(conversation)}</span></span><time className="text-[9px] text-slate-600">{conversation.updated_at ? new Date(conversation.updated_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'}</time></div></button> })}
            </div>
          </aside>

          <main className="flex min-h-[560px] flex-col rounded-2xl bg-[#0E1110] lg:min-h-[calc(100vh-150px)]">
            {!selected ? <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><MessageCircle size={34} className="mb-3 text-slate-600"/><h2 className="text-sm font-bold">Selecione uma conversa</h2><p className="mt-1 max-w-xs text-xs leading-5 text-slate-600">As mensagens recebidas dos seus funis conectados aparecem aqui em tempo real.</p></div> : <>
              <header className="flex items-center gap-3 bg-[#070708] px-4 py-3"><button type="button" className="rounded-lg p-2 text-slate-500 lg:hidden" onClick={() => setSelected(null)} aria-label="Voltar"><ArrowLeft size={17}/></button><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0E1110] text-xs font-black text-[#1DB854]">{(metadataFor(selected).name || 'C').slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{metadataFor(selected).name || 'Cliente'}</p><p className="truncate text-[10px] text-slate-500">{funnelName(selected)} · atendimento ativo</p></div></header>
              <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-5">{messagesLoading ? <p className="py-8 text-center text-xs text-slate-600">Carregando histórico...</p> : messages.length ? messages.map((message) => <motion.div key={message.id} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={spring} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${message.direction === 'outbound' ? 'bg-[#0D362D]' : 'bg-[#070708]'}`}><p className="whitespace-pre-wrap text-xs leading-5 text-slate-100">{message.body}</p><time className="mt-1 block text-right text-[9px] text-slate-600">{new Date(message.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time></div></motion.div>) : <p className="py-8 text-center text-xs text-slate-600">Nenhuma mensagem registrada.</p>}</div>
              {error && <p className="px-4 pb-2 text-[10px] text-red-400">{error}</p>}
              <form className="flex gap-2 bg-[#070708] p-3" onSubmit={(e) => { e.preventDefault(); void sendMessage() }}><input value={draft} onChange={(e) => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-xl bg-[#0E1110] px-3 text-xs text-white outline-none placeholder:text-slate-600" placeholder="Responder ao comprador..."/><button type="submit" disabled={sending || !draft.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1DB854] text-[#070708] disabled:opacity-40" aria-label="Enviar"><Send size={16}/></button></form>
            </>}
          </main>

          <aside className="rounded-2xl bg-[#0E1110] p-4 lg:min-h-[calc(100vh-150px)]">
            {!selected ? <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center"><UserRound size={28} className="mb-2 text-slate-600"/><p className="text-xs font-bold text-slate-500">CRM do comprador</p><p className="mt-1 max-w-xs text-[10px] leading-4 text-slate-600">Selecione um lead para cruzar identidade, origem e respostas do funil.</p></div> : <LeadPanel conversation={selected}/>} 
          </aside>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{funnels.map((funnel) => <div key={funnel.id} className="rounded-xl bg-[#0E1110] px-3 py-2.5"><div className="flex items-center justify-between"><span className="truncate text-xs font-bold">{funnel.name}</span><CheckCircle2 size={13} className="text-[#1DB854]"/></div><p className="mt-1 text-[9px] text-slate-600">{funnel.status || 'Conectado'} · espelhamento ativo</p></div>)}</div>
      </div>
      <nav className="mx-auto mt-3 flex max-w-md items-center justify-between rounded-2xl bg-[#0C1210] p-2 lg:hidden">{[['dashboard','Dashboard'],['vendas','Vendas'],['funis','Chat'],['gateways','Gateway'],['configuracoes','Config']].map(([key,label]) => <button key={key} type="button" onClick={() => go(key)} className={`flex min-h-11 flex-1 flex-col items-center justify-center rounded-xl ${active === key ? 'bg-[#070708] text-[#1DB854]' : 'text-slate-500'}`}><span className="text-sm">{key === 'dashboard' ? '⌂' : key === 'vendas' ? '▥' : key === 'funis' ? '▢' : key === 'gateways' ? '◇' : '⚙'}</span><small className="text-[8px] font-bold">{label}</small></button>)}</nav>
    </section>
  )
}

function LeadPanel({ conversation }: { conversation: Conversation }) {
  const meta = metadataFor(conversation)
  const labelMap: Record<string,string> = { como_conheceu: 'Como conheceu?', maior_desafio: 'Maior desafio hoje?', how_found: 'Como conheceu?', biggest_challenge: 'Maior desafio hoje?' }
  return <div className="space-y-5"><div><p className="text-[10px] font-bold tracking-[0.18em] text-slate-500">CRM DO COMPRADOR</p><div className="mt-3 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#070708] text-sm font-black text-[#1DB854]">{(meta.name || 'C').slice(0,1).toUpperCase()}</span><div className="min-w-0"><h2 className="truncate text-sm font-black">{meta.name || 'Cliente'}</h2><p className="truncate text-[10px] text-slate-500">{meta.email || 'E-mail não informado'}</p></div></div></div><Info label="Telefone" value={meta.phone}/><Info label="Origem" value={meta.source}/><Info label="Transação" value={conversation.transaction_id}/><div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-600">Respostas do quiz</p>{meta.quizEntries.length ? <div className="space-y-2">{meta.quizEntries.map(([key,value]) => <div key={key} className="rounded-xl bg-[#070708] p-3"><p className="text-[9px] font-bold text-slate-600">{labelMap[key] || key.replace(/[_-]/g,' ')}</p><p className="mt-1 text-xs leading-4 text-slate-200">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</p></div>)}</div> : <p className="rounded-xl bg-[#070708] p-3 text-[10px] text-slate-600">Nenhuma resposta de quiz disponível no payload recebido.</p>}</div><div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-600">Notas administrativas</p><div className="min-h-20 rounded-xl bg-[#070708] p-3 text-xs leading-5 text-slate-400">{meta.notes || 'Nenhuma nota administrativa registrada.'}</div></div></div>
}
function Info({ label, value }: { label: string; value: string | null | undefined }) { return <div className="flex items-center justify-between gap-3 rounded-xl bg-[#070708] px-3 py-2.5"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">{label}</span><span className="truncate text-right text-[10px] text-slate-300">{value || 'Não informado'}</span></div> }
