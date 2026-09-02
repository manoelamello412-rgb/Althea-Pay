'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Bot, Check, ChevronRight, MessageCircle, Plus, RefreshCw, Send, Settings2, UserRound, Webhook, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type WebhookEvent = { id: string; transaction_id: string | null; status: string; error_reason: string | null; buyer_email: string | null; buyer_name: string | null; payload: Record<string, unknown>; received_at: string }
type Conversation = { id: string; buyer_email: string | null; buyer_name: string | null; transaction_id: string | null; status: string }
type Message = { id: string; direction: 'inbound' | 'outbound' | 'system'; channel: string; body: string; created_at: string }
type TriggerRule = { id: string; name: string; enabled: boolean; event_type: string; conditions: Record<string, string>; action_type: string; action_config: Record<string, string> }

const initialRule: Omit<TriggerRule, 'id'> = { name: 'Recuperar insuficiência de fundos', enabled: true, event_type: 'transaction.failed', conditions: { transaction_status: 'failed', error_reason: 'insufficient_funds' }, action_type: 'automated_whatsapp_dispatch', action_config: { dynamic_discount_link: '/checkout/recovery?discount=10' } }

export default function CRMPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<WebhookEvent | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [message, setMessage] = useState('')
  const [rules, setRules] = useState<TriggerRule[]>([])
  const [rule, setRule] = useState<Omit<TriggerRule, 'id'>>(initialRule)
  const [showRules, setShowRules] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingRule, setSavingRule] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [mobilePanel, setMobilePanel] = useState<'events' | 'chat'>('events')

  async function load(): Promise<void> {
    setLoading(true); setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) { setError('Sessão expirada.'); setLoading(false); return }
    const [eventResult, conversationResult, ruleResult] = await Promise.all([
      supabase.from('crm_webhook_events').select('id,transaction_id,status,error_reason,buyer_email,buyer_name,payload,received_at').eq('user_id', auth.user.id).order('received_at', { ascending: false }).limit(100),
      supabase.from('crm_conversations').select('id,buyer_email,buyer_name,transaction_id,status').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(100),
      supabase.from('crm_trigger_rules').select('id,name,enabled,event_type,conditions,action_type,action_config').eq('user_id', auth.user.id).order('created_at', { ascending: false }),
    ])
    if (eventResult.error) setError(eventResult.error.message); else setEvents((eventResult.data ?? []) as WebhookEvent[])
    if (!conversationResult.error) setConversations((conversationResult.data ?? []) as Conversation[])
    if (!ruleResult.error) setRules((ruleResult.data ?? []) as TriggerRule[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return
      channel = supabase.channel(`crm-${data.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'crm_webhook_events', filter: `user_id=eq.${data.user.id}` }, () => { void load() }).on('postgres_changes', { event: '*', schema: 'public', table: 'crm_messages', filter: `user_id=eq.${data.user.id}` }, () => { if (selected) void loadMessages(selected) }).subscribe()
    })
    return () => { active = false; if (channel) void supabase.removeChannel(channel) }
  }, [selected, supabase])

  async function loadMessages(event: WebhookEvent): Promise<void> {
    const conversation = conversations.find((item) => item.transaction_id === event.transaction_id || item.buyer_email === event.buyer_email)
    if (!conversation) { setMessages([]); return }
    const result = await supabase.from('crm_messages').select('id,direction,channel,body,created_at').eq('conversation_id', conversation.id).order('created_at', { ascending: true }).limit(200)
    if (!result.error) setMessages((result.data ?? []) as Message[])
  }

  function selectEvent(event: WebhookEvent): void { setSelected(event); setMobilePanel('chat'); void loadMessages(event) }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!message.trim() || !selected) return
    setSending(true); setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      let conversation = conversations.find((item) => item.transaction_id === selected.transaction_id || item.buyer_email === selected.buyer_email)
      if (!conversation) {
        const created = await supabase.from('crm_conversations').insert({ user_id: auth.user.id, buyer_email: selected.buyer_email, buyer_name: selected.buyer_name, transaction_id: selected.transaction_id, status: 'open' }).select('id,buyer_email,buyer_name,transaction_id,status').single()
        if (created.error || !created.data) throw created.error ?? new Error('Não foi possível criar a conversa.')
        conversation = created.data as Conversation
        setConversations((current) => [conversation as Conversation, ...current])
      }
      const createdMessage = await supabase.from('crm_messages').insert({ conversation_id: conversation.id, user_id: auth.user.id, direction: 'outbound', channel: 'internal', body: message.trim(), metadata: { source: 'crm' } }).select('id,direction,channel,body,created_at').single()
      if (createdMessage.error || !createdMessage.data) throw createdMessage.error ?? new Error('Não foi possível enviar a mensagem.')
      setMessages((current) => [...current, createdMessage.data as Message]); setMessage('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao enviar mensagem.') } finally { setSending(false) }
  }

  async function saveRule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSavingRule(true); setError('')
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) throw authError ?? new Error('Sessão expirada.')
      const result = await supabase.from('crm_trigger_rules').insert({ user_id: auth.user.id, name: rule.name, enabled: rule.enabled, event_type: rule.event_type, conditions: rule.conditions, action_type: rule.action_type, action_config: rule.action_config }).select('id,name,enabled,event_type,conditions,action_type,action_config').single()
      if (result.error || !result.data) throw result.error ?? new Error('Não foi possível criar a automação.')
      setRules((current) => [result.data as TriggerRule, ...current]); setShowRules(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao salvar automação.') } finally { setSavingRule(false) }
  }

  async function toggleRule(item: TriggerRule): Promise<void> {
    const result = await supabase.from('crm_trigger_rules').update({ enabled: !item.enabled }).eq('id', item.id)
    if (result.error) setError(result.error.message); else setRules((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, enabled: !candidate.enabled } : candidate))
  }

  async function executeRecovery(event: WebhookEvent): Promise<void> {
    setError('')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.session) { setError('Sessão expirada.'); return }
    const response = await fetch('/api/crm/recovery', { method: 'POST', headers: { Authorization: `Bearer ${auth.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: event.id }) })
    if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; setError(body?.error ?? 'Gatilho não executado.'); return }
    await load()
  }

  return <main className="crm-shell">
    <header className="crm-header"><div><span className="crm-kicker"><Webhook size={14} /> CRM CORE · EVENT RECOVERY</span><h1>Comunicação inteligente</h1><p>Falhas transacionais entram em uma fila viva para recuperação, atendimento e automação.</p></div><div className="crm-actions"><button type="button" onClick={() => void load()}><RefreshCw size={16} />Atualizar</button><button className="crm-primary" type="button" onClick={() => setShowRules(true)}><Plus size={16} />Nova automação</button></div></header>
    {error && <div className="crm-error"><X size={17} />{error}</div>}
    <div className="crm-mobile-tabs"><button className={mobilePanel === 'events' ? 'active' : ''} onClick={() => setMobilePanel('events')}>Eventos</button><button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}>Chat</button></div>
    <section className="crm-split">
      <aside className={`crm-events ${mobilePanel === 'events' ? 'mobile-visible' : 'mobile-hidden'}`}><div className="crm-pane-head"><div><span>TRANSAÇÕES</span><strong>Falhas e abandonos</strong></div><b>{events.length}</b></div>{loading ? <div className="crm-empty">Carregando eventos…</div> : events.length === 0 ? <div className="crm-empty">Nenhum evento de recuperação.</div> : <div className="crm-event-list">{events.map((event) => <button key={event.id} className={selected?.id === event.id ? 'crm-event selected' : 'crm-event'} onClick={() => selectEvent(event)}><div className="crm-event-top"><span>{event.status}</span><time>{new Date(event.received_at).toLocaleString('pt-BR')}</time></div><strong>{event.buyer_name || event.buyer_email || 'Comprador sem identificação'}</strong><small>{event.error_reason || 'Falha transacional'}{event.transaction_id ? ` · ${event.transaction_id}` : ''}</small><ChevronRight size={16} /></button>)}</div>}</aside>
      <section className={`crm-chat ${mobilePanel === 'chat' ? 'mobile-visible' : 'mobile-hidden'}`}><div className="crm-chat-head">{selected ? <><div className="crm-avatar"><UserRound size={20} /></div><div><strong>{selected.buyer_name || selected.buyer_email || 'Comprador'}</strong><span>{selected.buyer_email || 'Sem e-mail'} · {selected.error_reason || selected.status}</span></div><button type="button" onClick={() => void executeRecovery(selected)}><Bot size={16} />Executar gatilho</button></> : <div className="crm-chat-placeholder"><MessageCircle size={25} /><strong>Selecione um evento</strong><span>O histórico do comprador aparecerá aqui.</span></div>}</div>{selected && <><div className="crm-context"><span>CONTEXTO DA TRANSAÇÃO</span><code>{JSON.stringify(selected.payload, null, 2)}</code></div><div className="crm-messages">{messages.map((item) => <div key={item.id} className={`crm-message ${item.direction}`}><span>{item.body}</span><time>{new Date(item.created_at).toLocaleString('pt-BR')}</time></div>)}{!messages.length && <div className="crm-empty">Sem mensagens ainda. Inicie o contato abaixo.</div>}</div><form className="crm-composer" onSubmit={(event) => void sendMessage(event)}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escreva uma mensagem interna…" /><button type="submit" disabled={sending || !message.trim()}><Send size={17} /></button></form></>}</section>
    </section>
    <section className="crm-automation"><div className="crm-pane-head"><div><span>AUTOMAÇÕES</span><strong>Trigger Engine</strong></div><button type="button" onClick={() => setShowRules(true)}><Settings2 size={16} />Gerenciar</button></div><div className="crm-rule-grid">{rules.map((item) => <article className="crm-rule" key={item.id}><div className="crm-rule-status"><i className={item.enabled ? 'on' : ''} /><span>{item.enabled ? 'Ativo' : 'Pausado'}</span><button onClick={() => void toggleRule(item)}>{item.enabled ? 'Pausar' : 'Ativar'}</button></div><strong>{item.name}</strong><code>IF {item.event_type} · {Object.entries(item.conditions).map(([key, value]) => `${key} == '${value}'`).join(' AND ')}</code><div className="crm-rule-action"><Check size={14} />THEN {item.action_type} · {Object.values(item.action_config).join(' · ')}</div></article>)}{!rules.length && <div className="crm-empty">Crie sua primeira automação de recuperação.</div>}</div></section>
    {showRules && <div className="crm-modal-backdrop" onMouseDown={() => setShowRules(false)}><section className="crm-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span>TRIGGER ENGINE</span><h2>Nova automação</h2></div><button type="button" onClick={() => setShowRules(false)}><X size={18} /></button></header><form onSubmit={(event) => void saveRule(event)}><label>Nome<input value={rule.name} onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))} /></label><div className="crm-two"><label>Evento<select value={rule.event_type} onChange={(event) => setRule((current) => ({ ...current, event_type: event.target.value }))}><option value="transaction.failed">transaction.failed</option><option value="transaction.abandoned">transaction.abandoned</option><option value="transaction.pending">transaction.pending</option></select></label><label>Ação<select value={rule.action_type} onChange={(event) => setRule((current) => ({ ...current, action_type: event.target.value }))}><option value="automated_whatsapp_dispatch">WhatsApp automático</option><option value="create_support_task">Criar tarefa</option><option value="emit_reverse_webhook">Emitir webhook inverso</option></select></label></div><div className="crm-condition"><span>IF</span><input value="transaction_status" readOnly /><select value={rule.conditions.transaction_status} onChange={(event) => setRule((current) => ({ ...current, conditions: { ...current.conditions, transaction_status: event.target.value } }))}><option value="failed">== 'failed'</option><option value="pending">== 'pending'</option></select></div><div className="crm-condition"><span>AND</span><input value="error_reason" readOnly /><input value={rule.conditions.error_reason} onChange={(event) => setRule((current) => ({ ...current, conditions: { ...current.conditions, error_reason: event.target.value } }))} /></div><label>Link dinâmico de desconto<input value={rule.action_config.dynamic_discount_link} onChange={(event) => setRule((current) => ({ ...current, action_config: { ...current.action_config, dynamic_discount_link: event.target.value } }))} /></label><button className="crm-primary crm-save" type="submit" disabled={savingRule}>{savingRule ? 'Salvando…' : 'Salvar gatilho'}</button></form></section></div>}
  </main>
}
