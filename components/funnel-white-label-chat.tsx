'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'

type Customer = { name?: string; email?: string; phone?: string }
type Cart = { items?: { name: string; amount: number }[]; total?: number }
type ChatMessage = { id: string; direction: 'inbound' | 'outbound' | 'system'; body: string; created_at: string }
type Props = {
  funnelId: string
  productName: string
  brandName?: string
  endpoint?: string
  eventToken?: string
  customer?: Customer
  quizSteps?: unknown[]
  cart?: Cart
}

type ConversationResponse = {
  conversation_token?: string
  conversation?: { status: string }
  messages?: ChatMessage[]
  error?: string
}

export function FunnelWhiteLabelChat({
  funnelId,
  productName,
  brandName,
  endpoint,
  eventToken,
  customer,
  quizSteps = [],
  cart = { items: [], total: 0 },
}: Props) {
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
    const timer = window.setInterval(() => void sync(token), 2500)
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
        body: JSON.stringify({
          event_type: 'chat_started',
          funnel_id: funnelId,
          product: productName,
          customer,
          quiz_steps: quizSteps,
          cart,
        }),
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
        body: JSON.stringify({
          event_type: 'chat_message',
          funnel_id: funnelId,
          product: productName,
          customer,
          quiz_steps: quizSteps,
          cart,
          message: body,
          conversation_token: token,
        }),
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

  return (
    <>
      <button
        type="button"
        aria-label={`Abrir ${brand}`}
        onClick={openChat}
        className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500 px-4 text-sm font-semibold text-black shadow-2xl shadow-black/40 transition hover:bg-emerald-400"
      >
        <MessageCircle size={19} />
        <span>Falar com suporte</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 sm:items-center sm:p-6">
          <section className="flex h-[min(680px,88vh)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b0f0d] text-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <b className="block truncate text-sm">{brand}</b>
                <small className="mt-0.5 block truncate text-[11px] text-white/45">{productName} · Atendimento</small>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="rounded-full p-2 text-white/55 hover:bg-white/5 hover:text-white">
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {loading && <p className="text-sm text-white/50">Conectando você ao atendimento…</p>}
              {!loading && messages.length === 0 && !error && (
                <div className="max-w-[86%] rounded-2xl rounded-bl-md bg-white/[0.08] px-3 py-2.5 text-sm text-white/80">
                  Olá! Como podemos ajudar você?
                </div>
              )}
              {messages.map(item => (
                <div key={item.id} className={`flex ${item.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[86%] rounded-2xl px-3 py-2.5 text-sm ${item.direction === 'inbound' ? 'rounded-br-md bg-emerald-500 text-black' : 'rounded-bl-md bg-white/[0.08] text-white/85'}`}>
                    <span className="whitespace-pre-wrap break-words">{item.body}</span>
                    <small className={`mt-1 block text-[9px] ${item.direction === 'inbound' ? 'text-black/55' : 'text-white/35'}`}>
                      {new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </div>
                </div>
              ))}
              {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
              <div ref={endRef} />
            </div>

            <footer className="flex items-end gap-2 border-t border-white/10 p-3">
              <textarea
                value={text}
                disabled={loading || sending || !token}
                onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submit()
                  }
                }}
                placeholder={loading ? 'Conectando…' : 'Digite sua mensagem…'}
                className="min-h-11 max-h-28 flex-1 resize-none rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-400/30"
              />
              <button
                type="button"
                aria-label="Enviar"
                disabled={loading || sending || !token || !text.trim()}
                onClick={() => void submit()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black disabled:opacity-35"
              >
                <Send size={17} />
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
