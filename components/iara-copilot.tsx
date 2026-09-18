'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Bot, CircleDollarSign, GitBranch, MessageCircle, Send, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type IaraResponse = { id: string; sender: string; content: string; created_at: string; error?: string }
type Message = { id: string; sender: 'user' | 'iara'; content: string }

const quickActions = [
  { label: 'Meus funis', icon: GitBranch, prompt: 'Mostre o estado dos meus funis.' },
  { label: 'Vendas', icon: CircleDollarSign, prompt: 'Analise minhas vendas mais recentes.' },
  { label: 'Clientes', icon: Users, prompt: 'Mostre um resumo dos meus clientes.' },
  { label: 'Produtos', icon: GitBranch, prompt: 'Mostre meus produtos e ofertas.' },
  { label: 'Pagamentos', icon: CircleDollarSign, prompt: 'Analise meus pagamentos e seus status.' },
  { label: 'Mais opções', icon: MessageCircle, prompt: 'Quais outras análises você consegue fazer?' },
] as const

export default function IaraCopilot() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [command, setCommand] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [assistantName, setAssistantName] = useState('IARA')
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let active = true

    async function hydrateConversation() {
      setInitializing(true)
      setError(null)
      try {
        const { data: auth, error: authError } = await db.auth.getUser()
        if (authError || !auth.user) {
          router.replace('/login')
          return
        }

        const [{ data: session, error: sessionError }, { data: settingsRow, error: settingsError }] = await Promise.all([
          db
            .from('chat_sessions')
            .select('id')
            .eq('user_id', auth.user.id)
            .eq('title', 'IARA')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          db
            .from('platform_settings')
            .select('data')
            .eq('user_id', auth.user.id)
            .maybeSingle(),
        ])

        if (sessionError) throw sessionError
        if (settingsError) throw settingsError
        const settingsData = settingsRow?.data && typeof settingsRow.data === 'object'
          ? settingsRow.data as Record<string, unknown>
          : {}
        const iaraSettings = settingsData.iara && typeof settingsData.iara === 'object'
          ? settingsData.iara as Record<string, unknown>
          : {}
        const configuredName = typeof iaraSettings.name === 'string' ? iaraSettings.name.trim() : ''
        if (active) setAssistantName(configuredName || 'IARA')
        if (!session?.id) {
          if (active) {
            setSessionId(null)
            setMessages([])
          }
          return
        }

        const { data: history, error: historyError } = await db
          .from('chat_messages')
          .select('id,sender,content')
          .eq('session_id', session.id)
          .eq('user_id', auth.user.id)
          .order('created_at', { ascending: true })
          .limit(200)

        if (historyError) throw historyError
        if (!active) return

        setSessionId(String(session.id))
        setMessages((history ?? [])
          .filter((item) => item.sender === 'user' || item.sender === 'iara')
          .map((item) => ({ id: String(item.id), sender: item.sender as 'user' | 'iara', content: String(item.content) })))
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o histórico da IARA.')
      } finally {
        if (active) setInitializing(false)
      }
    }

    void hydrateConversation()
    return () => { active = false }
  }, [db, router])

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

  const askIara = useCallback(async (event?: FormEvent, forcedText?: string) => {
    event?.preventDefault()
    const text = (forcedText ?? command).trim()
    if (!text || sending || initializing) return
    setCommand('')
    setSending(true)
    setError(null)
    const localId = crypto.randomUUID()
    setMessages((current) => [...current, { id: `user-${localId}`, sender: 'user', content: text }])
    try {
      const activeSessionId = await createIaraSession()
      if (!activeSessionId) throw new Error('Não foi possível iniciar a conversa com a IARA.')
      const { data: sessionState, error: sessionError } = await db.auth.getSession()
      if (sessionError || !sessionState.session?.access_token) {
        router.replace('/login')
        throw new Error('Sessão de autenticação indisponível. Faça login novamente.')
      }
      const { data, error: invokeError } = await db.functions.invoke<IaraResponse>('iara-ai-core', {
        body: { sessionId: activeSessionId, message: text, clientRequestId: localId },
        headers: { Authorization: `Bearer ${sessionState.session.access_token}` },
      })
      if (invokeError) {
        const context = 'context' in invokeError ? (invokeError as { context?: unknown }).context : undefined
        if (context instanceof Response) {
          let detail = ''
          try {
            const payload = await context.clone().json() as { error?: unknown }
            detail = typeof payload?.error === 'string' ? payload.error : ''
          } catch {
            detail = ''
          }
          if (detail) throw new Error(detail)
        }
        throw new Error(invokeError.message || 'A IARA não conseguiu processar sua mensagem.')
      }
      if (data?.error) throw new Error(data.error)
      if (!data?.content || data.sender !== 'iara') throw new Error('A IARA retornou uma resposta inválida.')
      setMessages((current) => [...current, { id: data.id || `iara-${crypto.randomUUID()}`, sender: 'iara', content: data.content }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.')
    } finally {
      setSending(false)
    }
  }, [command, createIaraSession, db, initializing, router, sending])

  const empty = !initializing && messages.length === 0

  return (
    <section className="min-h-[calc(100dvh-5rem)] bg-[#050908] px-3 pb-32 pt-3 text-white sm:px-5 sm:pt-5">
      <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-[920px] flex-col overflow-hidden rounded-[24px] border border-[#1DBB54]/20 bg-[#07110d] shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <header className="flex items-center gap-3 border-b border-white/[0.055] bg-[#08120e]/95 px-5 py-4 backdrop-blur-xl sm:px-6">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#1DBB54]/20 bg-[#1DBB54]/[0.10] text-[#1DBB54] shadow-[0_0_28px_rgba(29,184,84,0.10)]"><Bot className="h-6 w-6" strokeWidth={1.8} /></div>
          <div className="min-w-0"><h1 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{assistantName}</h1><p className="mt-0.5 flex items-center gap-1.5 text-sm text-[#8a9891]"><span className="h-2 w-2 rounded-full bg-[#1DBB54] shadow-[0_0_10px_rgba(29,184,84,0.7)]" /> Inteligência da Althea Pay</p></div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7">
          {initializing ? (
            <div className="mx-auto max-w-3xl space-y-4 py-8">
              <div className="h-16 animate-pulse rounded-2xl border border-white/[0.04] bg-white/[0.025]" />
              <div className="h-24 animate-pulse rounded-2xl border border-white/[0.04] bg-white/[0.025]" />
              <p className="text-center text-xs text-[#68756e]">Sincronizando seu histórico com a IARA…</p>
            </div>
          ) : empty ? (
            <div className="mx-auto max-w-[760px]">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#1DBB54]/20 bg-[#0a3326] text-[#1DBB54]"><Bot className="h-5 w-5" /></div>
                <div className="max-w-[88%] rounded-[20px] rounded-bl-md border border-white/[0.055] bg-[#101917] px-5 py-4 text-[15px] leading-[1.65] text-[#e5ebe7] shadow-[0_16px_45px_rgba(0,0,0,0.18)]">
                  <p>Olá. Eu sou {assistantName}, a inteligência da <span className="text-[#1DBB54]">Althea Pay</span>.</p><p className="mt-3">Posso analisar os dados reais da sua operação, incluindo funis, vendas, clientes, pagamentos, checkouts e gateways.</p><p className="mt-3">Como posso te ajudar?</p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">{quickActions.map(({ label, icon: Icon, prompt }) => <button key={label} type="button" disabled={sending} onClick={() => void askIara(undefined, prompt)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[#1DBB54]/25 bg-[#07150f] px-3 text-xs font-medium text-[#d9e3dc] transition hover:border-[#1DBB54]/50 hover:bg-[#0a2117] disabled:opacity-50"><Icon size={17} className="text-[#1DBB54]" strokeWidth={1.8} /><span>{label}</span></button>)}</div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">{messages.map((message) => <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>{message.sender === 'iara' && <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#1DBB54]/20 bg-[#0a3326] text-[#1DBB54]"><Bot className="h-5 w-5" /></div>}<div className={message.sender === 'user' ? 'max-w-[82%] rounded-[20px] rounded-br-md bg-[#0cbd55] px-5 py-3.5 text-[15px] leading-6 text-white shadow-[0_12px_35px_rgba(29,184,84,0.12)]' : 'max-w-[88%] rounded-[20px] rounded-bl-md border border-white/[0.055] bg-[#101917] px-5 py-4 text-[15px] leading-6 text-[#e5ebe7]'}>{message.sender === 'iara' && <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1DBB54]">{assistantName}</div>}<p className="whitespace-pre-wrap">{message.content}</p></div></div>)}{sending && <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-full border border-[#1DBB54]/20 bg-[#0a3326] text-[#1DBB54]"><Bot className="h-5 w-5" /></div><div className="rounded-[20px] rounded-bl-md border border-white/[0.055] bg-[#101917] px-5 py-4 text-xs text-[#87938c]">{assistantName} está analisando…</div></div>}</div>
          )}
        </div>

        {error && <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-950/15 px-3 py-2.5 text-xs text-rose-200 sm:mx-6"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" /><span>{error}</span></div>}

        <form onSubmit={(event) => void askIara(event)} className="border-t border-white/[0.055] bg-[#07110d] p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-[30px] border border-[#1DBB54]/35 bg-[#0b1512] p-1.5 shadow-[0_0_25px_rgba(29,184,84,0.05)] focus-within:border-[#1DBB54]/60">
            <Bot className="ml-3 h-5 w-5 shrink-0 text-[#738079]" /><input value={command} onChange={(event) => setCommand(event.target.value)} disabled={sending || initializing} placeholder={`Pergunte qualquer coisa à ${assistantName}...`} aria-label={`Mensagem para ${assistantName}`} className="min-w-0 flex-1 bg-transparent px-1 py-3 text-[15px] text-white outline-none placeholder:text-[#68756e]" /><button type="submit" disabled={!command.trim() || sending || initializing} aria-label="Enviar mensagem" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#0cbd55] text-white shadow-[0_0_25px_rgba(29,184,84,0.25)] transition hover:scale-[1.03] disabled:opacity-30"><Send className="h-5 w-5 -rotate-1" /></button>
          </div>
        </form>
      </div>
    </section>
  )
}
