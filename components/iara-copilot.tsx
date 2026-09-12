'use client'

import { useCallback, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Bot, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type IaraResponse = { id: string; sender: string; content: string; created_at: string; error?: string }
type Message = { id: string; sender: 'user' | 'iara'; content: string }

export default function IaraCopilot() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [command, setCommand] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const createIaraSession = useCallback(async () => {
    if (sessionId) return sessionId
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) {
      router.replace('/login')
      return null
    }
    const { data, error: createError } = await db.from('chat_sessions').insert({ user_id: auth.user.id, title: 'IARA' }).select('id').single()
    if (createError || !data?.id) return null
    setSessionId(String(data.id))
    return String(data.id)
  }, [db, router, sessionId])

  const askIara = useCallback(async (event?: FormEvent) => {
    event?.preventDefault()
    const text = command.trim()
    if (!text || sending) return
    setCommand('')
    setSending(true)
    setError(null)
    const localId = crypto.randomUUID()
    setMessages((current) => [...current, { id: `user-${localId}`, sender: 'user', content: text }])
    try {
      const activeSessionId = await createIaraSession()
      if (!activeSessionId) throw new Error('Não foi possível iniciar a conversa com a IARA.')
      const { data, error: invokeError } = await db.functions.invoke<IaraResponse>('iara-ai-core', {
        body: { sessionId: activeSessionId, message: text, clientRequestId: localId },
      })
      if (invokeError) throw new Error(invokeError.message || 'A IARA não conseguiu processar sua mensagem.')
      if (data?.error) throw new Error(data.error)
      if (!data?.content || data.sender !== 'iara') throw new Error('A IARA retornou uma resposta inválida.')
      setMessages((current) => [...current, { id: data.id || `iara-${crypto.randomUUID()}`, sender: 'iara', content: data.content }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.')
    } finally {
      setSending(false)
    }
  }, [command, createIaraSession, db, sending])

  return (
    <section className="min-h-[calc(100dvh-5rem)] bg-[var(--althea-bg)] px-4 pb-36 pt-4 text-[var(--althea-white)] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-3xl flex-col overflow-hidden rounded-[var(--althea-card-radius)] border border-[var(--althea-border)] bg-[var(--althea-surface)] shadow-[var(--althea-panel-shadow)]">
        <header className="flex items-center gap-3 border-b border-[var(--althea-border)] px-4 py-4 sm:px-6">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--althea-border)] bg-[var(--althea-inner)]">
            <Bot className="h-5 w-5 text-[var(--althea-brand)]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-wide text-[var(--althea-white)]">IARA</h1>
            <p className="mt-0.5 text-[11px] text-[var(--althea-muted)]">Inteligência da Althea Pay</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[var(--althea-border)] bg-[var(--althea-inner)]">
                <Bot className="h-7 w-7 text-[var(--althea-brand)]" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[var(--althea-white)]">Converse com a IARA</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--althea-muted)]">
                Pergunte sobre sua operação, vendas, pagamentos, gateways, funis, checkouts, clientes ou CRM. A IARA consulta os dados reais disponíveis para responder.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-5">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={message.sender === 'user'
                    ? 'max-w-[85%] rounded-2xl rounded-br-md bg-[var(--althea-brand)] px-4 py-3 text-sm leading-relaxed text-black'
                    : 'max-w-[90%] rounded-2xl rounded-bl-md border border-[var(--althea-border)] bg-[var(--althea-inner)] px-4 py-3 text-sm leading-relaxed text-[var(--althea-white)]'}>
                    {message.sender === 'iara' && <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--althea-brand)]"><Bot className="h-3.5 w-3.5" /> IARA</div>}
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}
              {sending && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border border-[var(--althea-border)] bg-[var(--althea-inner)] px-4 py-3 text-xs text-[var(--althea-muted)]">IARA está analisando…</div></div>}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-950/15 px-3 py-2.5 text-xs text-rose-200 sm:mx-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(event) => void askIara(event)} className="border-t border-[var(--althea-border)] bg-[var(--althea-surface)] p-3 sm:p-4">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-[var(--althea-border)] bg-[var(--althea-bg)] p-2 focus-within:border-[var(--althea-brand)]/35">
            <Bot className="ml-2 h-4 w-4 shrink-0 text-[var(--althea-muted)]" />
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              disabled={sending}
              placeholder="Pergunte qualquer coisa à IARA..."
              aria-label="Mensagem para a IARA"
              className="min-w-0 flex-1 bg-transparent px-1 py-3 text-sm text-[var(--althea-white)] outline-none placeholder:text-[var(--althea-muted)]"
            />
            <button
              type="submit"
              disabled={!command.trim() || sending}
              aria-label="Enviar mensagem"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--althea-brand)] text-black transition-opacity disabled:opacity-30"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
