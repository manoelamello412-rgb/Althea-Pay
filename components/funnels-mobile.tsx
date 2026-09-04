'use client'

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ArrowLeft, GitBranch, MessageCircle, Plus, Search, Send, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Funnel = { id: string; name: string; status?: string }
type Conversation = {
  id: string
  funnel_id?: string | null
  buyer_name?: string | null
  buyer_email?: string | null
  status?: string | null
  updated_at?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}
type CrmMessage = {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  channel?: string | null
  body: string
  created_at: string
}

const spring = { type: 'spring' as const, stiffness: 420, damping: 30, mass: 0.7 }
const softSpring = { type: 'spring' as const, stiffness: 280, damping: 28, mass: 0.85 }

export default function FunnelsMobile() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [active, setActive] = useState('funis')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'Todas' | 'Não lidas' | 'Funis'>('Todas')
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [chats, setChats] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<CrmMessage[]>([])
  const [messageDraft, setMessageDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const handler = (event: Event) => setActive((event as CustomEvent<string>).detail || 'dashboard')
    window.addEventListener('althea-mobile-page', handler)
    return () => window.removeEventListener('althea-mobile-page', handler)
  }, [])

  useEffect(() => {
    let cancelled = false
    let conversationChannel: ReturnType<typeof db.channel> | null = null
    let messageChannel: ReturnType<typeof db.channel> | null = null

    async function load(): Promise<void> {
      setLoading(true)
      setError('')
      const { data: auth } = await db.auth.getUser()
      if (!auth.user) {
        setLoading(false)
        return
      }

      const [funnelsResult, conversationsResult] = await Promise.all([
        db.from('funnels').select('id,nome,status').eq('user_id', auth.user.id).is('deleted_at', null),
        db.from('crm_conversations').select('id,funnel_id,buyer_name,buyer_email,status,updated_at,created_at,metadata').eq('user_id', auth.user.id).order('updated_at', { ascending: false }),
      ])
      if (cancelled) return
      if (funnelsResult.error || conversationsResult.error) {
        setError(funnelsResult.error?.message || conversationsResult.error?.message || 'Não foi possível carregar a central de atendimento.')
        setLoading(false)
        return
      }

      setFunnels((funnelsResult.data ?? []).map((funnel) => ({ id: String(funnel.id), name: funnel.nome || 'Funil sem nome', status: funnel.status || undefined })))
      setChats((conversationsResult.data ?? []) as Conversation[])
      setLoading(false)

      const refreshConversations = async () => {
        const result = await db.from('crm_conversations').select('id,funnel_id,buyer_name,buyer_email,status,updated_at,created_at,metadata').eq('user_id', auth.user.id).order('updated_at', { ascending: false })
        if (!result.error) setChats((result.data ?? []) as Conversation[])
      }

      conversationChannel = db.channel(`crm-conversations-${auth.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversations', filter: `user_id=eq.${auth.user.id}` }, () => void refreshConversations())
        .subscribe()

      messageChannel = db.channel(`crm-messages-${auth.user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_messages', filter: `user_id=eq.${auth.user.id}` }, (payload) => {
          const incoming = payload.new as CrmMessage
          setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at)))
          void refreshConversations()
        })
        .subscribe()
    }

    void load()
    return () => {
      cancelled = true
      if (conversationChannel) void db.removeChannel(conversationChannel)
      if (messageChannel) void db.removeChannel(messageChannel)
    }
  }, [db])

  const funnelById = useMemo(() => new Map(funnels.map((funnel) => [funnel.id, funnel])), [funnels])

  const getFunnelId = (conversation: Conversation) => conversation.funnel_id || (typeof conversation.metadata?.funnel_id === 'string' ? conversation.metadata.funnel_id : null)
  const getFunnelName = (conversation: Conversation) => {
    const funnelId = getFunnelId(conversation)
    return funnelId ? (funnelById.get(funnelId)?.name || 'Funil não identificado') : 'Origem não vinculada'
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return chats.filter((conversation) => {
      const matchesTab = tab === 'Todas' || (tab === 'Não lidas' && conversation.status === 'unread') || (tab === 'Funis' && !!getFunnelId(conversation))
      const searchable = `${conversation.buyer_name || ''} ${conversation.buyer_email || ''} ${getFunnelName(conversation)}`.toLowerCase()
      return matchesTab && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [chats, query, tab, funnelById])

  useEffect(() => {
    let cancelled = false
    async function loadMessages(): Promise<void> {
      if (!selected) {
        setMessages([])
        return
      }
      setMessagesLoading(true)
      const result = await db.from('crm_messages').select('id,conversation_id,direction,channel,body,created_at').eq('conversation_id', selected.id).order('created_at', { ascending: true })
      if (!cancelled) {
        setMessages(result.error ? [] : (result.data ?? []) as CrmMessage[])
        setMessagesLoading(false)
      }
    }
    void loadMessages()
    return () => { cancelled = true }
  }, [db, selected])

  const go = (page: string) => {
    setActive(page)
    window.dispatchEvent(new CustomEvent('althea-mobile-page', { detail: page }))
  }

  async function sendMessage(): Promise<void> {
    if (!selected || !messageDraft.trim() || sending) return
    setSending(true)
    setError('')
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) {
      setError('Sessão expirada.')
      setSending(false)
      return
    }
    const result = await db.from('crm_messages').insert({ conversation_id: selected.id, user_id: auth.user.id, direction: 'outbound', channel: 'funnel_chat', body: messageDraft.trim() }).select('id,conversation_id,direction,channel,body,created_at').single()
    if (result.error) setError(result.error.message)
    else setMessageDraft('')
    setSending(false)
  }

  if (active !== 'funis') return null

  return (
    <section className="althea-mobile-funnels" aria-label="Central de atendimento multitarefa">
      <header className="amf-header">
        <img src="/althea-logo.png" alt="Althea Pay" />
        <motion.button type="button" aria-label="Nova conversa" whileTap={{ scale: 0.95 }} transition={spring} onClick={() => setError('Novas conversas são iniciadas pelo fluxo de atendimento do funil.')}>
          <Plus size={20} />
        </motion.button>
      </header>

      <main className="amf-content">
        <div className="amf-title-row"><div><h1>Funis & Chat</h1><p>Caixa de entrada multitarefa · {chats.length} conversas</p></div><div className="amf-live-dot"><i /> Ao vivo</div></div>

        <label className="amf-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente ou funil..." aria-label="Buscar conversas" /></label>

        <LayoutGroup id="crm-filters">
          <div className="amf-tabs" role="tablist" aria-label="Filtros de conversas">
            {(['Todas', 'Não lidas', 'Funis'] as const).map((item) => (
              <motion.button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} whileTap={{ scale: 0.95 }} transition={spring}>
                {tab === item && <motion.span layoutId="crm-filter-pill" className="amf-tab-indicator" transition={softSpring} />}
                <span>{item}</span>
                {item !== 'Funis' && <em>{item === 'Todas' ? chats.length : chats.filter((conversation) => conversation.status === 'unread').length}</em>}
              </motion.button>
            ))}
          </div>
        </LayoutGroup>

        {error && <div className="amf-error" role="alert">{error}</div>}

        <section className="amf-card amf-inbox-card">
          <div className="amf-card-head"><div><strong>CAIXA DE ENTRADA</strong><small>Atualização em tempo real</small></div><span>{filtered.length}</span></div>
          {loading ? <div className="amf-empty"><div className="amf-skeleton" /><div className="amf-skeleton short" /><span>Carregando conversas...</span></div> : filtered.length === 0 ? <div className="amf-empty"><MessageCircle size={48} /><strong>Nenhuma conversa encontrada</strong><p>Quando um atendimento chegar de um funil conectado, ele aparecerá aqui.</p></div> : (
            <LayoutGroup id="crm-conversations">
              <div className="amf-chat-list">
                <AnimatePresence initial={false} mode="popLayout">
                  {filtered.map((conversation) => {
                    const funnelName = getFunnelName(conversation)
                    const selectedChat = selected?.id === conversation.id
                    return (
                      <motion.button
                        layout
                        layoutId={`conversation-${conversation.id}`}
                        key={conversation.id}
                        type="button"
                        className={`amf-chat-row ${selectedChat ? 'selected' : ''}`}
                        onClick={() => setSelected(conversation)}
                        initial={{ opacity: 0, x: -18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 18, scale: 0.98 }}
                        transition={{ ...softSpring, opacity: { duration: 0.18 } }}
                        whileTap={{ scale: 0.985 }}
                      >
                        <span className="amf-avatar">{(conversation.buyer_name || conversation.buyer_email || 'C').slice(0, 1).toUpperCase()}</span>
                        <span className="amf-chat-main"><b>{conversation.buyer_name || 'Cliente'}</b><small>{conversation.buyer_email || 'Atendimento ativo'}</small><span className="amf-funnel-badge"><GitBranch size={11} /> {funnelName}</span></span>
                        <span className="amf-chat-meta"><time>{conversation.updated_at ? new Date(conversation.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</time>{conversation.status === 'unread' && <i aria-label="Não lida" />}</span>
                      </motion.button>
                    )
                  })}
                </AnimatePresence>
              </div>
            </LayoutGroup>
          )}
        </section>

        <section className="amf-funnels"><div className="amf-card-head"><div><strong>FUNIS CONECTADOS</strong><small>Origem dos atendimentos</small></div><span>{funnels.length}</span></div>{funnels.length ? funnels.map((funnel) => <div className="amf-funnel-row" key={funnel.id}><GitBranch size={16} /><div><strong>{funnel.name}</strong><small>{funnel.status || 'Status não informado'}</small></div></div>) : <p className="amf-funnel-empty">Nenhum funil conectado.</p>}</section>
      </main>

      <AnimatePresence>
        {selected && (
          <motion.div className="amf-modal" role="dialog" aria-modal="true" aria-label="Detalhes da conversa" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="amf-sheet" layoutId={`conversation-${selected.id}`} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={softSpring}>
              <header className="amf-sheet-head"><button type="button" onClick={() => setSelected(null)} aria-label="Voltar"><ArrowLeft size={19} /></button><div><span>ATENDIMENTO</span><strong>{getFunnelName(selected)}</strong></div><button type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={19} /></button></header>
              <div className="amf-sheet-customer"><span className="amf-avatar large">{(selected.buyer_name || selected.buyer_email || 'C').slice(0, 1).toUpperCase()}</span><div><h2>{selected.buyer_name || 'Cliente'}</h2><p>{selected.buyer_email || 'Contato do funil'}</p></div></div>
              <div className="amf-messages" aria-live="polite">
                {messagesLoading ? <div className="amf-empty compact"><span>Carregando histórico...</span></div> : messages.length ? messages.map((message) => <motion.div layout key={message.id} className={`amf-message ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={softSpring}><p>{message.body}</p><time>{new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></motion.div>) : <div className="amf-empty compact"><MessageCircle size={32} /><span>Nenhuma mensagem registrada nesta conversa.</span></div>}
              </div>
              <form className="amf-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}><input value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Escreva uma mensagem..." aria-label="Mensagem" /><motion.button type="submit" aria-label="Enviar mensagem" disabled={sending || !messageDraft.trim()} whileTap={{ scale: 0.95 }} transition={spring}><Send size={17} /></motion.button></form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="amf-bottom-nav">{[['dashboard', 'Dashboard'], ['vendas', 'Vendas'], ['funis', 'Funis'], ['gateways', 'Gateway'], ['configuracoes', 'Config']].map(([key, label]) => <motion.button key={key} type="button" className={active === key ? 'active' : ''} onClick={() => go(key)} whileTap={{ scale: 0.95 }} transition={spring}><span>{key === 'dashboard' ? '⌂' : key === 'vendas' ? '▥' : key === 'funis' ? '▢' : key === 'gateways' ? '◇' : '⚙'}</span><small>{label}</small></motion.button>)}</nav>
    </section>
  )
}
