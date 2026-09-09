'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleUserRound,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { MobileBottomNav } from '@/components/mobile-bottom-nav'
import { MobileHeaderDashboard } from '@/components/mobile-header-dashboard'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type WebhookEvent = {
  id: string
  transaction_id: string | null
  status: string
  error_reason: string | null
  buyer_email: string | null
  buyer_name: string | null
  payload: Record<string, unknown>
  received_at: string
}

type Conversation = {
  id: string
  buyer_email: string | null
  buyer_name: string | null
  transaction_id: string | null
  status: string
  updated_at?: string
}

type Message = {
  id: string
  direction: 'inbound' | 'outbound' | 'system'
  channel: string
  body: string
  created_at: string
}

type TriggerRule = {
  id: string
  name: string
  enabled: boolean
  event_type: string
  conditions: Record<string, string>
  action_type: string
  action_config: Record<string, string>
}

type InboxItem = Conversation & {
  event: WebhookEvent | null
  snippet: string
  lastAt: string
  unread: number
}

const initialRule: Omit<TriggerRule, 'id'> = {
  name: 'Recuperar insuficiência de fundos',
  enabled: true,
  event_type: 'transaction.failed',
  conditions: { transaction_status: 'failed', error_reason: 'insufficient_funds' },
  action_type: 'automated_whatsapp_dispatch',
  action_config: { dynamic_discount_link: '/checkout/recovery?discount=10' },
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function payloadValue(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = textValue(payload[key])
    if (direct) return direct
  }
  const buyer = payload.buyer
  if (buyer && typeof buyer === 'object') {
    const buyerRecord = buyer as Record<string, unknown>
    for (const key of keys) {
      const nested = textValue(buyerRecord[key])
      if (nested) return nested
    }
  }
  const customer = payload.customer
  if (customer && typeof customer === 'object') {
    const customerRecord = customer as Record<string, unknown>
    for (const key of keys) {
      const nested = textValue(customerRecord[key])
      if (nested) return nested
    }
  }
  return null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function CRMPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState('')
  const [rules, setRules] = useState<TriggerRule[]>([])
  const [rule, setRule] = useState<Omit<TriggerRule, 'id'>>(initialRule)
  const [showRules, setShowRules] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [savingRule, setSavingRule] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all')
  const [mobilePanel, setMobilePanel] = useState<'inbox' | 'chat'>('inbox')
  const [showContext, setShowContext] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')

    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) {
      setError('Sessão expirada. Faça login novamente.')
      setLoading(false)
      return
    }

    const [eventResult, conversationResult, ruleResult] = await Promise.all([
      supabase
        .from('crm_webhook_events')
        .select('id,transaction_id,status,error_reason,buyer_email,buyer_name,payload,received_at')
        .eq('user_id', auth.user.id)
        .order('received_at', { ascending: false })
        .limit(100),
      supabase
        .from('crm_conversations')
        .select('id,buyer_email,buyer_name,transaction_id,status,updated_at')
        .eq('user_id', auth.user.id)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('crm_trigger_rules')
        .select('id,name,enabled,event_type,conditions,action_type,action_config')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false }),
    ])

    if (eventResult.error) setError(eventResult.error.message)
    else setEvents((eventResult.data ?? []) as WebhookEvent[])

    if (conversationResult.error) setError((current) => current || conversationResult.error.message)
    else setConversations((conversationResult.data ?? []) as Conversation[])

    if (!ruleResult.error) setRules((ruleResult.data ?? []) as TriggerRule[])

    setLoading(false)
  }, [supabase])

  const loadMessages = useCallback(
    async (conversationId: string): Promise<void> => {
      const result = await supabase
        .from('crm_messages')
        .select('id,direction,channel,body,created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(200)

      if (result.error) setError(result.error.message)
      else setMessages((result.data ?? []) as Message[])
    },
    [supabase],
  )

  useEffect(() => {
    void load()

    let channel: ReturnType<typeof supabase.channel> | null = null
    let active = true

    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return
      channel = supabase
        .channel(`crm-realtime-${data.user.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'crm_webhook_events', filter: `user_id=eq.${data.user.id}` },
          () => void load(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'crm_conversations', filter: `user_id=eq.${data.user.id}` },
          () => void load(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'crm_messages', filter: `user_id=eq.${data.user.id}` },
          () => {
            if (selectedId) void loadMessages(selectedId)
            void load()
          },
        )
        .subscribe()
    })

    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [load, loadMessages, selectedId, supabase])

  const eventByConversation = useMemo(() => {
    const map = new Map<string, WebhookEvent>()
    for (const conversation of conversations) {
      const event = events.find(
        (candidate) =>
          (conversation.transaction_id && candidate.transaction_id === conversation.transaction_id) ||
          (conversation.buyer_email && candidate.buyer_email === conversation.buyer_email),
      )
      if (event) map.set(conversation.id, event)
    }
    return map
  }, [conversations, events])

  const inbox = useMemo<InboxItem[]>(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase('pt-BR')

    return conversations
      .map((conversation) => {
        const event = eventByConversation.get(conversation.id) ?? null
        const snippet = event?.error_reason || event?.status || 'Conversa sem mensagens'
        const lastAt = conversation.updated_at || event?.received_at || ''
        return { ...conversation, event, snippet, lastAt, unread: conversation.status.toLowerCase() === 'unread' ? 1 : 0 }
      })
      .filter((item) => {
        const matchesTab = activeTab === 'all' || item.unread > 0
        const haystack = `${item.buyer_name ?? ''} ${item.buyer_email ?? ''} ${item.snippet}`.toLocaleLowerCase('pt-BR')
        return matchesTab && (!normalizedSearch || haystack.includes(normalizedSearch))
      })
      .sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime())
  }, [activeTab, conversations, eventByConversation, searchQuery])

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? inbox[0] ?? null,
    [conversations, inbox, selectedId],
  )

  const selectedEvent = selectedConversation?.event ?? null

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      return
    }
    setSelectedId(selectedConversation.id)
    void loadMessages(selectedConversation.id)
  }, [loadMessages, selectedConversation])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const buyerName = selectedConversation?.buyer_name || selectedEvent?.buyer_name || 'Comprador'
  const buyerEmail = selectedConversation?.buyer_email || selectedEvent?.buyer_email || null
  const buyerPayload = selectedEvent?.payload ?? {}
  const funnelName = payloadValue(buyerPayload, ['funnel_name', 'funnel', 'funnelName']) || 'Não informado'
  const productName = payloadValue(buyerPayload, ['product_name', 'product', 'productName']) || 'Não informado'
  const phone = payloadValue(buyerPayload, ['phone', 'telephone', 'mobile']) || 'Não informado'
  const origin = payloadValue(buyerPayload, ['origin', 'source', 'utm_source']) || 'Não informado'
  const discovery = payloadValue(buyerPayload, ['discovery', 'how_found', 'como_conheceu']) || 'Não informado'
  const challenge = payloadValue(buyerPayload, ['biggest_challenge', 'challenge', 'maior_desafio']) || 'Não informado'
  const invested = payloadValue(buyerPayload, ['already_invested', 'invested', 'ja_investiu']) || 'Não informado'
  const mainGoal = payloadValue(buyerPayload, ['main_goal', 'goal', 'objetivo']) || 'Não informado'
  const notes = payloadValue(buyerPayload, ['notes', 'note', 'observations']) || 'Nenhuma nota registrada.'

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!message.trim() || !selectedConversation) return

    setSending(true)
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')

      const created = await supabase
        .from('crm_messages')
        .insert({
          conversation_id: selectedConversation.id,
          user_id: auth.user.id,
          direction: 'outbound',
          channel: 'internal',
          body: message.trim(),
          metadata: { source: 'crm_hub' },
        })
        .select('id,direction,channel,body,created_at')
        .single()

      if (created.error || !created.data) throw created.error ?? new Error('Não foi possível enviar a mensagem.')

      setMessages((current) => [...current, created.data as Message])
      setMessage('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao enviar mensagem.')
    } finally {
      setSending(false)
    }
  }

  async function markResolved(): Promise<void> {
    if (!selectedConversation) return
    setError('')
    const result = await supabase.from('crm_conversations').update({ status: 'resolved' }).eq('id', selectedConversation.id)
    if (result.error) setError(result.error.message)
    else await load()
  }

  async function saveRule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSavingRule(true)
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')

      const result = await supabase
        .from('crm_trigger_rules')
        .insert({
          user_id: auth.user.id,
          name: rule.name,
          enabled: rule.enabled,
          event_type: rule.event_type,
          conditions: rule.conditions,
          action_type: rule.action_type,
          action_config: rule.action_config,
        })
        .select('id,name,enabled,event_type,conditions,action_type,action_config')
        .single()

      if (result.error || !result.data) throw result.error ?? new Error('Não foi possível criar a automação.')
      setRules((current) => [result.data as TriggerRule, ...current])
      setShowRules(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar automação.')
    } finally {
      setSavingRule(false)
    }
  }

  async function toggleRule(item: TriggerRule): Promise<void> {
    const result = await supabase.from('crm_trigger_rules').update({ enabled: !item.enabled }).eq('id', item.id)
    if (result.error) setError(result.error.message)
    else setRules((current) => current.map((candidate) => (candidate.id === item.id ? { ...candidate, enabled: !candidate.enabled } : candidate)))
  }

  async function executeRecovery(event: WebhookEvent): Promise<void> {
    setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession()
      if (authError || !auth.session) throw authError ?? new Error('Sessão expirada.')

      const response = await fetch('/api/crm/recovery', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_id: event.id }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Gatilho não executado.')
      }

      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao executar gatilho.')
    }
  }

  return (
    <div className="chat-page">
      <MobileHeaderDashboard pageTitle="Chat" />

      <header className="chat-brand-header">
        <div className="chat-brand-lockup">
          <span className="chat-brand-leaf">⌁</span>
          <strong>ALTHEA<span>PAY</span></strong>
          <em>// CHAT</em>
        </div>
        <div className="chat-search-global">
          <Search size={17} />
          <span>Buscar</span>
        </div>
      </header>

      <main className="chat-workspace">
        <section className="chat-title-row">
          <div>
            <h1>Chat</h1>
            <p>Conversa de todos os seus funis em um só lugar</p>
          </div>
          <div className="chat-title-actions">
            <button type="button" onClick={() => void load()} title="Atualizar"><RefreshCw size={16} /></button>
            <button type="button" onClick={() => setShowRules(true)} title="Automações"><Settings2 size={16} /></button>
          </div>
        </section>

        {error && (
          <div className="chat-error">
            <X size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="chat-mobile-tabs">
          <button className={mobilePanel === 'inbox' ? 'active' : ''} onClick={() => setMobilePanel('inbox')}>Conversas</button>
          <button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}>Atendimento</button>
        </div>

        <section className="chat-shell">
          <aside className={`chat-inbox ${mobilePanel === 'inbox' ? 'mobile-show' : 'mobile-hide'}`}>
            <div className="chat-section-heading">
              <div>
                <span>CONVERSAS ATIVAS</span>
                <strong>{conversations.length}</strong>
              </div>
              <button type="button" onClick={() => setShowRules(true)}><Plus size={15} /></button>
            </div>

            <div className="chat-inbox-search">
              <Search size={16} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar conversas..." />
            </div>

            <div className="chat-tabs">
              <button className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')}>Todas <b>{conversations.length}</b></button>
              <button className={activeTab === 'unread' ? 'active' : ''} onClick={() => setActiveTab('unread')}>Não lidas <b>{conversations.filter((item) => item.status.toLowerCase() === 'unread').length}</b></button>
              <button type="button" className="funnel-tab">Funis <ChevronDown size={13} /></button>
            </div>

            <div className="chat-inbox-list">
              {loading && <div className="chat-empty">Sincronizando conversas…</div>}
              {!loading && inbox.length === 0 && <div className="chat-empty">Nenhuma conversa encontrada.</div>}
              {!loading && inbox.map((item) => {
                const name = item.buyer_name || item.buyer_email || 'Comprador'
                const active = item.id === selectedConversation?.id
                return (
                  <button key={item.id} type="button" className={`chat-inbox-item ${active ? 'active' : ''}`} onClick={() => { setSelectedId(item.id); setMobilePanel('chat') }}>
                    <div className="chat-avatar"><span>{initials(name)}</span><i /></div>
                    <div className="chat-inbox-copy">
                      <div><strong>{name}</strong><time>{formatTime(item.lastAt)}</time></div>
                      <small>{item.event ? (item.event.error_reason || item.event.status) : 'Conversa'}</small>
                      <p>{item.snippet}</p>
                    </div>
                    {item.unread > 0 && <b className="chat-unread">{item.unread}</b>}
                  </button>
                )
              })}
            </div>
          </aside>

          <section className={`chat-conversation ${mobilePanel === 'chat' ? 'mobile-show' : 'mobile-hide'}`}>
            {selectedConversation ? (
              <>
                <header className="conversation-header">
                  <div className="chat-avatar large"><span>{initials(buyerName)}</span><i /></div>
                  <div className="conversation-person">
                    <strong>{buyerName}</strong>
                    <span>{funnelName} · {buyerEmail || 'e-mail não informado'}</span>
                  </div>
                  <div className="conversation-actions">
                    {selectedEvent && <button type="button" onClick={() => void executeRecovery(selectedEvent)}><Sparkles size={15} /> Recuperar</button>}
                    <button type="button" onClick={() => void markResolved()}><Check size={15} /> Resolvido</button>
                    <button type="button" onClick={() => setShowContext((current) => !current)}><CircleUserRound size={16} /></button>
                  </div>
                </header>

                <div className="conversation-status">
                  <span className="status-dot" />
                  <span>Atendimento sincronizado em realtime</span>
                  {selectedEvent && <code>{selectedEvent.status}</code>}
                </div>

                <div className="conversation-body">
                  <div className="message-list">
                    {messages.length === 0 && <div className="chat-empty large-empty"><MessageCircle size={24} /><strong>Nenhuma mensagem ainda</strong><span>O histórico deste comprador aparecerá aqui assim que houver uma mensagem.</span></div>}
                    {messages.map((item) => (
                      <div key={item.id} className={`message-row ${item.direction}`}>
                        <div className="message-bubble">
                          <span>{item.body}</span>
                          <time>{formatTime(item.created_at)} {item.direction === 'outbound' && <CheckCheck size={12} />}</time>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
                    <button type="button" title="Anexo"><Paperclip size={16} /></button>
                    <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Digite sua mensagem..." />
                    <button className="send-button" type="submit" disabled={sending || !message.trim()} title="Enviar"><Send size={17} /></button>
                  </form>
                </div>

                {showContext && (
                  <aside className="buyer-context">
                    <div className="context-heading"><div><span>CRM DO COMPRADOR</span><strong>Contexto da conversa</strong></div><ArrowUpRight size={15} /></div>
                    <div className="context-grid">
                      <div><span>Nome</span><strong>{buyerName}</strong></div>
                      <div><span>E-mail</span><strong>{buyerEmail || 'Não informado'}</strong></div>
                      <div><span>Telefone</span><strong>{phone}</strong></div>
                      <div><span>Funil / Produto</span><strong>{funnelName} / {productName}</strong></div>
                      <div><span>Origem</span><strong>{origin}</strong></div>
                      <div><span>Status</span><strong>{selectedConversation.status}</strong></div>
                      <div><span>Como conheceu?</span><strong>{discovery}</strong></div>
                      <div><span>Maior desafio hoje?</span><strong>{challenge}</strong></div>
                      <div><span>Já investiu em cursos?</span><strong>{invested}</strong></div>
                      <div><span>Objetivo principal</span><strong>{mainGoal}</strong></div>
                    </div>
                    <div className="context-notes"><span>NOTAS</span><p>{notes}</p></div>
                    {selectedEvent && <details className="event-details"><summary>Dados técnicos do evento</summary><pre>{JSON.stringify(selectedEvent.payload, null, 2)}</pre><small>Recebido em {formatDateTime(selectedEvent.received_at)}</small></details>}
                  </aside>
                )}
              </>
            ) : (
              <div className="chat-empty conversation-empty"><MessageCircle size={32} /><strong>Selecione uma conversa</strong><span>As conversas reais do CRM aparecerão neste painel.</span></div>
            )}
          </section>
        </section>

        <section className="automation-strip">
          <div className="automation-head"><div><span>TRIGGER ENGINE</span><strong>Automações de recuperação</strong></div><button type="button" onClick={() => setShowRules(true)}><Plus size={15} /> Nova</button></div>
          <div className="automation-list">
            {rules.length === 0 && <div className="chat-empty">Nenhuma automação configurada.</div>}
            {rules.map((item) => (
              <article key={item.id} className="automation-card">
                <div className="automation-status"><i className={item.enabled ? 'on' : ''} /><span>{item.enabled ? 'Ativo' : 'Pausado'}</span><button type="button" onClick={() => void toggleRule(item)}>{item.enabled ? 'Pausar' : 'Ativar'}</button></div>
                <strong>{item.name}</strong>
                <code>IF {item.event_type} · {Object.entries(item.conditions).map(([key, value]) => `${key} = '${value}'`).join(' AND ')}</code>
              </article>
            ))}
          </div>
        </section>
      </main>

      <MobileBottomNav />

      {showRules && (
        <div className="chat-modal-backdrop" onMouseDown={() => setShowRules(false)}>
          <section className="chat-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>TRIGGER ENGINE</span><h2>Nova automação</h2></div><button type="button" onClick={() => setShowRules(false)}><X size={18} /></button></header>
            <form onSubmit={(event) => void saveRule(event)}>
              <label>Nome<input value={rule.name} onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))} /></label>
              <div className="modal-two">
                <label>Evento<select value={rule.event_type} onChange={(event) => setRule((current) => ({ ...current, event_type: event.target.value }))}><option value="transaction.failed">transaction.failed</option><option value="transaction.abandoned">transaction.abandoned</option><option value="transaction.pending">transaction.pending</option></select></label>
                <label>Ação<select value={rule.action_type} onChange={(event) => setRule((current) => ({ ...current, action_type: event.target.value }))}><option value="automated_whatsapp_dispatch">WhatsApp automático</option><option value="create_support_task">Criar tarefa</option><option value="emit_reverse_webhook">Emitir webhook inverso</option></select></label>
              </div>
              <label>Motivo<input value={rule.conditions.error_reason} onChange={(event) => setRule((current) => ({ ...current, conditions: { ...current.conditions, error_reason: event.target.value } }))} /></label>
              <label>Link dinâmico<input value={rule.action_config.dynamic_discount_link} onChange={(event) => setRule((current) => ({ ...current, action_config: { ...current.action_config, dynamic_discount_link: event.target.value } }))} /></label>
              <button className="modal-save" type="submit" disabled={savingRule}>{savingRule ? 'Salvando…' : 'Salvar automação'}</button>
            </form>
          </section>
        </div>
      )}

      <style jsx global>{`
        .chat-page{min-height:100vh;background:#020304;color:#f4f7f5;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-.01em;padding-bottom:28px}
        .chat-page *{box-sizing:border-box}
        .chat-brand-header{height:84px;border:1px solid rgba(255,255,255,.12);border-top:0;border-left:0;border-right:0;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(20px,4vw,52px);background:linear-gradient(180deg,#050708,#020304);position:sticky;top:0;z-index:30}
        .chat-brand-lockup{display:flex;align-items:center;gap:12px;white-space:nowrap}.chat-brand-lockup strong{font-size:23px;letter-spacing:.16em;font-weight:500}.chat-brand-lockup strong span{color:#20c95a}.chat-brand-lockup em{font-style:normal;color:#a2aaa6;font-size:17px;letter-spacing:.02em}.chat-brand-leaf{display:grid;place-items:center;width:38px;height:44px;color:#1bc457;font-size:46px;line-height:1;transform:rotate(-28deg);text-shadow:0 0 18px rgba(27,196,87,.35)}
        .chat-search-global{height:48px;width:210px;border:1px solid rgba(255,255,255,.22);border-radius:11px;display:flex;align-items:center;gap:12px;padding:0 15px;color:#c7ccc9;font-size:14px}.chat-search-global svg{color:#e6eae8}
        .chat-workspace{width:min(100%,1180px);margin:0 auto;padding:24px 24px 100px}.chat-title-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:17px}.chat-title-row h1{font-size:29px;line-height:1;margin:0 0 8px;font-weight:600}.chat-title-row p{margin:0;color:#9aa39f;font-size:14px}.chat-title-actions{display:flex;gap:8px}.chat-title-actions button{border:1px solid rgba(255,255,255,.1);background:#080a0b;color:#9aa39f;border-radius:9px;width:36px;height:36px;display:grid;place-items:center}.chat-title-actions button:hover{color:#fff;border-color:rgba(32,201,90,.4)}
        .chat-error{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,90,110,.28);background:rgba(65,11,18,.45);color:#ffb9c2;padding:10px 12px;border-radius:10px;font-size:12px;margin-bottom:12px}.chat-mobile-tabs{display:none}
        .chat-shell{display:grid;grid-template-columns:330px minmax(0,1fr);min-height:680px;border:1px solid rgba(255,255,255,.11);border-radius:16px;overflow:hidden;background:#050708;box-shadow:0 25px 80px rgba(0,0,0,.3)}
        .chat-inbox{border-right:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,#070909,#040506);min-width:0}.chat-section-heading{display:flex;justify-content:space-between;align-items:center;padding:18px 18px 14px}.chat-section-heading div{display:flex;align-items:center;gap:8px}.chat-section-heading span,.automation-head span,.context-heading span{font-size:9px;color:#818b86;letter-spacing:.18em}.chat-section-heading strong{font-size:11px;color:#1fca5a}.chat-section-heading button{width:29px;height:29px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#0a0d0c;color:#7f8b84;display:grid;place-items:center}
        .chat-inbox-search{height:41px;margin:0 13px 11px;border:1px solid rgba(255,255,255,.1);border-radius:9px;display:flex;align-items:center;gap:9px;padding:0 11px;background:#050708}.chat-inbox-search svg{color:#747d79}.chat-inbox-search input{border:0;outline:0;background:transparent;color:#e8ecea;width:100%;font-size:12px}.chat-inbox-search input::placeholder{color:#626a67}
        .chat-tabs{display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,.07);margin:0 13px}.chat-tabs button{border:0;background:transparent;color:#747c78;padding:9px 7px;font-size:11px;display:flex;align-items:center;gap:5px;position:relative}.chat-tabs button.active{color:#29cf62}.chat-tabs button.active:after{content:"";position:absolute;height:2px;background:#22c85a;left:3px;right:3px;bottom:-1px}.chat-tabs b{font-weight:500;color:inherit}.chat-tabs .funnel-tab{margin-left:auto}.chat-inbox-list{max-height:560px;overflow:auto}.chat-inbox-item{width:100%;display:flex;align-items:center;gap:10px;text-align:left;border:0;border-bottom:1px solid rgba(255,255,255,.055);background:transparent;color:#fff;padding:12px 13px;min-height:76px}.chat-inbox-item:hover{background:rgba(255,255,255,.018)}.chat-inbox-item.active{background:linear-gradient(90deg,rgba(9,67,35,.72),rgba(5,29,17,.34));box-shadow:inset 2px 0 #1ac457}.chat-avatar{width:37px;height:37px;border-radius:50%;background:linear-gradient(145deg,#bfc8c2,#59625e);display:grid;place-items:center;position:relative;flex:none;border:1px solid rgba(255,255,255,.13);overflow:visible}.chat-avatar span{font-size:11px;color:#101513;font-weight:700}.chat-avatar i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:#15c55a;border:2px solid #060807}.chat-avatar.large{width:42px;height:42px}.chat-inbox-copy{min-width:0;flex:1}.chat-inbox-copy>div{display:flex;justify-content:space-between;gap:6px}.chat-inbox-copy strong{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-inbox-copy time{font-size:10px;color:#858d89;flex:none}.chat-inbox-copy small{display:block;color:#31c965;font-size:9px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-inbox-copy p{margin:2px 0 0;color:#909894;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-unread{width:21px;height:21px;border-radius:50%;background:#0d9f49;color:#fff;display:grid;place-items:center;font-size:10px;flex:none}
        .chat-conversation{min-width:0;background:radial-gradient(circle at 80% 0%,rgba(20,151,69,.055),transparent 35%),#030506;display:flex;flex-direction:column}.conversation-header{min-height:76px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:11px;padding:12px 17px}.conversation-person{min-width:0;flex:1}.conversation-person strong{display:block;font-size:14px}.conversation-person span{display:block;margin-top:3px;color:#77807c;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.conversation-actions{display:flex;gap:6px}.conversation-actions button{border:1px solid rgba(255,255,255,.1);background:#080b0a;color:#9ba49f;border-radius:8px;height:32px;padding:0 9px;display:flex;align-items:center;gap:6px;font-size:10px}.conversation-actions button:hover{border-color:rgba(32,201,90,.35);color:#2bd263}.conversation-actions button:first-child{color:#2bd263}
        .conversation-status{height:34px;padding:0 18px;display:flex;align-items:center;gap:7px;border-bottom:1px solid rgba(255,255,255,.045);color:#68716d;font-size:9px}.conversation-status code{margin-left:auto;color:#89938e;background:#0a0d0c;border:1px solid rgba(255,255,255,.07);border-radius:999px;padding:3px 7px;font-size:8px}.status-dot{width:6px;height:6px;border-radius:50%;background:#19c95b;box-shadow:0 0 9px rgba(25,201,91,.65)}
        .conversation-body{display:flex;flex:1;min-height:370px;flex-direction:column}.message-list{padding:20px 18px;overflow:auto;flex:1;min-height:320px}.message-row{display:flex;margin:7px 0}.message-row.inbound{justify-content:flex-start}.message-row.outbound{justify-content:flex-end}.message-row.system{justify-content:center}.message-bubble{max-width:min(76%,470px);padding:9px 11px;border-radius:11px;border:1px solid rgba(255,255,255,.06);background:#0b0e0f;color:#dbe1de;font-size:11px;line-height:1.45}.message-row.outbound .message-bubble{background:linear-gradient(145deg,rgba(5,85,42,.82),rgba(3,55,29,.8));border-color:rgba(28,197,89,.16);color:#dcf8e5;border-top-right-radius:3px}.message-row.inbound .message-bubble{border-top-left-radius:3px}.message-row.system .message-bubble{background:#080b0b;color:#6f7974;font-size:9px}.message-bubble time{display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:5px;color:#68716d;font-size:8px}.message-row.outbound .message-bubble time{color:#54a875}.large-empty{min-height:250px}
        .message-composer{height:54px;margin:0 16px 15px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:#070a0a;display:flex;align-items:center;padding:0 7px;gap:5px}.message-composer button{width:34px;height:34px;border:0;background:transparent;color:#68736e;display:grid;place-items:center;border-radius:7px}.message-composer input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#edf2ef;font-size:11px}.message-composer input::placeholder{color:#5d6662}.message-composer .send-button{border:1px solid rgba(24,197,87,.3);color:#19ca59;background:rgba(12,52,29,.28)}.message-composer .send-button:disabled{opacity:.35}
        .buyer-context{border-top:1px solid rgba(255,255,255,.08);padding:15px 17px;background:linear-gradient(180deg,#070909,#050607)}.context-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}.context-heading strong{display:block;font-size:12px;margin-top:4px}.context-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px;border:1px solid rgba(255,255,255,.055);border-radius:9px;padding:11px}.context-grid div{min-width:0}.context-grid span{display:block;color:#707975;font-size:8px;margin-bottom:3px}.context-grid strong{display:block;color:#d6ddd9;font-size:10px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.context-notes{margin-top:10px;border:1px solid rgba(255,255,255,.055);border-radius:9px;padding:10px}.context-notes>span{font-size:8px;color:#747e79;letter-spacing:.16em}.context-notes p{margin:5px 0 0;color:#aab3ae;font-size:10px}.event-details{margin-top:9px;border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:8px;color:#7b8781;font-size:9px}.event-details summary{cursor:pointer;color:#a0aaa5}.event-details pre{max-height:150px;overflow:auto;margin:8px 0;color:#7fa58c;font-size:8px;white-space:pre-wrap}
        .chat-empty{display:grid;place-items:center;text-align:center;gap:6px;color:#68716d;padding:35px 18px;font-size:10px}.chat-empty strong{color:#b4bdb8;font-size:11px}.chat-empty span{max-width:280px;line-height:1.5}.conversation-empty{height:100%;min-height:500px}.conversation-empty svg{color:#1bc95b}
        .automation-strip{margin-top:16px;border:1px solid rgba(255,255,255,.1);border-radius:13px;background:#050708;padding:14px}.automation-head{display:flex;align-items:center;justify-content:space-between}.automation-head strong{display:block;font-size:13px;margin-top:4px}.automation-head button{display:flex;align-items:center;gap:5px;background:#0a0d0b;border:1px solid rgba(255,255,255,.1);color:#9da7a2;border-radius:8px;padding:7px 10px;font-size:10px}.automation-list{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.automation-card{border:1px solid rgba(255,255,255,.07);border-radius:9px;background:#070a0a;padding:10px}.automation-status{display:flex;align-items:center;gap:5px;font-size:8px;color:#6e7974;margin-bottom:8px}.automation-status i{width:6px;height:6px;border-radius:50%;background:#5b635f}.automation-status i.on{background:#19c95b;box-shadow:0 0 8px rgba(25,201,91,.55)}.automation-status button{margin-left:auto;border:0;background:transparent;color:#7e8983;font-size:8px}.automation-card>strong{display:block;font-size:10px;font-weight:500;margin-bottom:6px}.automation-card code{display:block;color:#5f6d66;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .chat-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(8px);z-index:100;display:grid;place-items:center;padding:20px}.chat-modal{width:min(100%,500px);border:1px solid rgba(53,209,104,.2);border-radius:15px;background:#070a09;box-shadow:0 30px 100px rgba(0,0,0,.6);padding:18px}.chat-modal header{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.chat-modal header span{font-size:8px;color:#718079;letter-spacing:.18em}.chat-modal h2{margin:5px 0 0;font-size:20px;font-weight:500}.chat-modal header button{border:0;background:transparent;color:#7f8984}.chat-modal form{display:grid;gap:12px}.chat-modal label{display:grid;gap:6px;color:#a9b2ad;font-size:10px}.chat-modal input,.chat-modal select{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#030505;color:#e8edea;padding:10px;font-size:11px;outline:0}.chat-modal input:focus,.chat-modal select:focus{border-color:rgba(31,201,91,.45)}.modal-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.modal-save{height:40px;border:1px solid rgba(100,231,145,.3);background:linear-gradient(135deg,#a8f0c0,#43ce72);color:#031108;border-radius:8px;font-weight:700;font-size:11px}.modal-save:disabled{opacity:.55}
        @media(max-width:850px){.chat-brand-header{height:68px;padding:0 15px}.chat-brand-lockup{gap:7px}.chat-brand-lockup strong{font-size:15px;letter-spacing:.12em}.chat-brand-lockup em{font-size:12px}.chat-brand-leaf{width:25px;height:30px;font-size:32px}.chat-search-global{width:112px;height:40px;font-size:12px}.chat-workspace{padding:17px 13px 110px}.chat-title-row h1{font-size:24px}.chat-title-row p{font-size:11px}.chat-shell{grid-template-columns:1fr;min-height:620px;border-radius:11px}.chat-mobile-tabs{display:flex;margin-bottom:10px;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:3px;background:#070909}.chat-mobile-tabs button{flex:1;border:0;background:transparent;color:#727b77;border-radius:7px;padding:8px;font-size:10px}.chat-mobile-tabs button.active{background:#0c2116;color:#2bd263}.mobile-hide{display:none!important}.mobile-show{display:flex!important}.chat-inbox{border-right:0;min-height:580px;display:flex;flex-direction:column}.chat-inbox-list{max-height:none;flex:1}.chat-conversation{min-height:640px}.conversation-actions button{font-size:0;width:31px;padding:0;justify-content:center}.conversation-actions button svg{width:15px}.conversation-header{padding:10px}.conversation-status{padding:0 11px}.message-list{padding:14px 10px}.message-bubble{max-width:86%}.buyer-context{padding:13px 10px}.context-grid{grid-template-columns:1fr 1fr;gap:8px 12px}.automation-list{grid-template-columns:1fr}.chat-title-actions{display:none}}
        @media(max-width:520px){.chat-brand-lockup em{display:none}.chat-search-global{width:103px}.chat-workspace{padding-left:9px;padding-right:9px}.chat-shell{border-left:0;border-right:0}.conversation-person span{max-width:150px}.conversation-actions button:first-child{display:none}.context-grid{grid-template-columns:1fr}.modal-two{grid-template-columns:1fr}}
      `}</style>
    </div>
  )
}
