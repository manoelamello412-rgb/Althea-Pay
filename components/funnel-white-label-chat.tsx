'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'

type Customer = { name?: string; email?: string; phone?: string }
type Cart = { items?: { name: string; amount: number }[]; total?: number }
type ChatMessage = { id: string; direction: 'inbound' | 'outbound' | 'system'; body: string; created_at: string }
type Props = { funnelId: string; productName: string; brandName?: string; endpoint?: string; eventToken?: string; customer?: Customer; quizSteps?: unknown[]; cart?: Cart }

type ConversationResponse = { conversation_token?: string; conversation?: { status: string }; messages?: ChatMessage[]; error?: string }

export function FunnelWhiteLabelChat({ funnelId, productName, brandName, endpoint, eventToken, customer, quizSteps = [], cart = { items: [], total: 0 } }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)
  const api = endpoint || '/api/funnel/chat'
  const brand = brandName || `Suporte ${productName}`

  const sync = useCallback(async (conversationToken: string) => {
    if (!conversationToken) return
    try {
      const response = await fetch(`${api}?token=${encodeURIComponent(conversationToken)}`, { cache: 'no-store' })
      const data = await response.json() as ConversationResponse
      if (!response.ok) throw new Error(data.error || 'Não foi possível atualizar o atendimento.')
      setMessages(data.messages ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha de sincronização.')
    }
  }, [api])

  useEffect(() => {
    if (!open || !token) return
    const timer = window.setInterval(() => void sync(token), 2000)
    void sync(token)
    return () => window.clearInterval(timer)
  }, [open, token, sync])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function start() {
    if (token) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(eventToken ? { 'x-funnel-event-token': eventToken } : {}) },
        body: JSON.stringify({ event_type: 'chat_started', funnel_id: funnelId, product: productName, customer, quiz_steps: quizSteps, cart }),
        cache: 'no-store',
      })
      const data = await response.json() as ConversationResponse
      if (!response.ok || !data.conversation_token) throw new Error(data.error || 'Não foi possível iniciar o atendimento.')
      setToken(data.conversation_token)
      setMessages(data.messages ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao iniciar o atendimento.')
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    const body = text.trim()
    if (!body || !token || sending) return
    setText('')
    setSending(true)
    setError('')
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(eventToken ? { 'x-funnel-event-token': eventToken } : {}) },
        body: JSON.stringify({ event_type: 'chat_message', funnel_id: funnelId, product: productName, customer, quiz_steps: quizSteps, cart, message: body, conversation_token: token }),
        cache: 'no-store',
      })
      const data = await response.json() as ConversationResponse
      if (!response.ok) throw new Error(data.error || 'Não foi possível enviar sua mensagem.')
      if (data.messages) setMessages(data.messages)
      else await sync(token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao enviar mensagem.')
      setText(body)
    } finally {
      setSending(false)
    }
  }

  function openChat() {
    setOpen(true)
    void start()
  }

  return <>
    <button aria-label={`Abrir ${brand}`} className="fwl-chat-launch" onClick={openChat}>
      <MessageCircle size={20} />
      <span>Falar com suporte</span>
    </button>
    {open && <div className="fwl-chat-layer">
      <section className="fwl-chat-card" aria-live="polite">
        <header>
          <div><b>{brand}</b><small>{productName} · Atendimento humano</small></div>
          <button aria-label="Fechar" onClick={() => setOpen(false)}><X /></button>
        </header>
        <div className="fwl-chat-messages">
          {loading && <p>Conectando você ao atendimento…</p>}
          {!loading && messages.length === 0 && <p>Olá! Como podemos ajudar você?</p>}
          {messages.map((item) => <div className={`fwl-chat-message ${item.direction}`} key={item.id}>
            <span>{item.body}</span>
            <small>{new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>)}
          {error && <p role="alert">{error}</p>}
          <div ref={endRef} />
        </div>
        <footer>
          <textarea value={text} disabled={loading || sending || !token} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }} placeholder={loading ? 'Conectando…' : 'Digite sua mensagem…'} />
          <button aria-label="Enviar" disabled={loading || sending || !token || !text.trim()} onClick={() => void submit()}><Send size={17} /></button>
        </footer>
      </section>
    </div>}
  </>
}
