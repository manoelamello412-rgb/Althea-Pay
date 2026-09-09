'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, ChevronLeft, MessageSquarePlus, Send, ShieldCheck } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Session = { id: string; title: string; updated_at: string }
type Message = { id: string; sender: 'user' | 'iara'; content: string; created_at: string }

const WELCOME: Message = {
  id: 'iara-welcome', sender: 'iara', created_at: new Date(0).toISOString(),
  content: 'Olá! Eu sou a Iara, sua copiloto da Althea Pay. Posso te ajudar com a operação, vendas, gateways, checkout, funis e configurações disponíveis no painel. O que você precisa?',
}

export default function IaraCopilot() {
  const db = useRef(createSupabaseBrowserClient()).current
  const bottom = useRef<HTMLDivElement>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scroll = useCallback(() => requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth' })), [])

  const createSession = useCallback(async () => {
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return
    const { data, error: createError } = await db.from('chat_sessions').insert({ user_id: auth.user.id, title: 'Nova Conversa' }).select('id,title,updated_at').single()
    if (createError) { setError('Não foi possível abrir uma nova conversa.'); return }
    const session = data as Session
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)])
    setActiveId(session.id)
    setMessages([])
    setError(null)
  }, [db])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) { window.location.href = '/login'; return }
      const { data, error: sessionError } = await db.from('chat_sessions').select('id,title,updated_at').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(50)
      if (sessionError) { setError('Não foi possível carregar o histórico.'); setLoading(false); return }
      if (cancelled) return
      const rows = (data ?? []) as Session[]
      setSessions(rows)
      if (rows[0]) setActiveId(rows[0].id)
      else await createSession()
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [createSession, db])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    const loadMessages = async () => {
      const { data, error: messageError } = await db.from('chat_messages').select('id,sender,content,created_at').eq('session_id', activeId).order('created_at', { ascending: true }).limit(200)
      if (!cancelled && !messageError) { setMessages((data ?? []) as Message[]); scroll() }
    }
    void loadMessages()
    const channel = db.channel(`iara-chat-${activeId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${activeId}` }, (payload) => {
      const fresh = payload.new as Message
      setMessages((current) => current.some((item) => item.id === fresh.id) ? current : [...current, fresh])
      scroll()
    }).subscribe()
    return () => { cancelled = true; void db.removeChannel(channel) }
  }, [activeId, db, scroll])

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || !activeId || sending) return
    setInput(''); setSending(true); setError(null)
    try {
      const response = await fetch('/api/iara/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeId, message: text }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'A Iara não conseguiu processar a mensagem.')
      scroll()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao enviar mensagem.')
      setInput(text)
    } finally { setSending(false) }
  }

  if (loading) return <div className="flex min-h-[70vh] items-center justify-center bg-[#060608] text-xs text-zinc-500">Carregando Iara…</div>

  return (
    <section className="flex min-h-[calc(100dvh-5rem)] w-full flex-col overflow-hidden bg-[#060608] pb-32 text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-[#191921] bg-[#0b0b0f] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00f5d4]/10 text-[#00f5d4]"><Bot size={18}/></span><div><h1 className="text-sm font-bold">Iara</h1><p className="text-[10px] text-zinc-500">Copiloto operacional · online</p></div></div>
        <button type="button" onClick={() => void createSession()} className="flex min-h-11 items-center gap-2 rounded-xl border border-[#191921] bg-[#0b0b0f] px-3 text-[11px] font-semibold text-zinc-300 hover:text-white"><MessageSquarePlus size={15}/> <span className="hidden sm:inline">Nova conversa</span></button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-[#191921] bg-[#0b0b0f] p-2 md:block">
          <div className="px-3 py-3 text-[10px] font-bold uppercase tracking-[.15em] text-zinc-600">Histórico</div>
          {sessions.map((session) => <button key={session.id} type="button" onClick={() => setActiveId(session.id)} className={`mb-1 flex min-h-11 w-full items-center rounded-xl px-3 text-left text-xs ${activeId === session.id ? 'border border-[#191921] bg-[#121217] text-white' : 'text-zinc-500 hover:bg-[#121217] hover:text-zinc-200'}`}>{session.title}</button>)}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              <div className="flex items-start gap-3"><span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00f5d4] text-[9px] font-black text-black">IA</span><div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-[#191921] bg-[#0b0b0f] px-4 py-3 text-xs leading-relaxed text-zinc-300"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#00f5d4]">Iara</span>{WELCOME.content}</div></div>
              {messages.map((message) => <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}><span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[9px] font-black ${message.sender === 'user' ? 'bg-[#121217] text-zinc-400' : 'bg-[#00f5d4] text-black'}`}>{message.sender === 'user' ? 'EU' : 'IA'}</span><div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl border px-4 py-3 text-xs leading-relaxed ${message.sender === 'user' ? 'order-first border-[#191921] bg-[#121217] text-zinc-200' : 'border-[#191921] bg-[#0b0b0f] text-zinc-300'}`}>{message.content}</div></div>)}
              {sending && <div className="flex items-center gap-2 text-[10px] text-zinc-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00f5d4]"/> Iara está processando…</div>}
              <div ref={bottom}/>
            </div>
          </div>

          <div className="shrink-0 border-t border-[#191921] bg-[#060608] px-3 py-3 sm:px-6">
            <form onSubmit={send} className="mx-auto max-w-3xl">
              {error && <div className="mb-2 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-[10px] text-red-300"><ShieldCheck size={13}/>{error}</div>}
              <div className="flex items-end gap-2 rounded-2xl border border-[#191921] bg-[#0b0b0f] p-2 focus-within:border-[#00f5d4]/30">
                <button type="button" onClick={() => setActiveId(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-600 md:hidden" aria-label="Fechar Iara"><ChevronLeft size={18}/></button>
                <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(event) } }} rows={1} maxLength={8000} placeholder="Pergunte à Iara…" className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-3 text-xs text-white outline-none placeholder:text-zinc-700" />
                <button type="submit" disabled={!input.trim() || !activeId || sending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#00f5d4] text-black transition disabled:cursor-not-allowed disabled:opacity-30" aria-label="Enviar mensagem"><Send size={16}/></button>
              </div>
              <p className="mt-2 text-center text-[9px] text-zinc-700">A Iara não executa código nem altera infraestrutura. Respostas podem exigir validação operacional.</p>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}
