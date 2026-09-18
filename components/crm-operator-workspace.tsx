'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AtSign,
  Check,
  CheckCircle2,
  Clock3,
  ListTodo,
  MessageSquareText,
  Plus,
  StickyNote,
  Tag,
  Timer,
  UserRound,
  Zap,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>
type Workspace = {
  sla: Json | null
  notes: Json[]
  tags: Json[]
  available_tags: Json[]
  tasks: Json[]
  quick_replies: Json[]
  identities: Json[]
  delivery_events: Json[]
  outbox: Json[]
}

const EMPTY: Workspace = {
  sla: null,
  notes: [],
  tags: [],
  available_tags: [],
  tasks: [],
  quick_replies: [],
  identities: [],
  delivery_events: [],
  outbox: [],
}

const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const arr = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Json[] : []

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value)

const dateTime = (value: unknown): string => {
  const parsed = new Date(text(value))
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(parsed)
}

const slaLabel: Record<string, string> = {
  met: 'SLA atendido',
  breached: 'SLA violado',
  breached_open: 'SLA vencido',
  at_risk: 'SLA em risco',
  not_started: 'SLA não iniciado',
}

const slaClass: Record<string, string> = {
  met: 'border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] text-[#7bdc9b]',
  at_risk: 'border-[rgba(212,175,55,.16)] bg-[rgba(212,175,55,.055)] text-[#D4AF37]',
  breached: 'border-red-400/15 bg-red-400/[.05] text-red-300',
  breached_open: 'border-red-400/15 bg-red-400/[.05] text-red-300',
  not_started: 'border-white/[.06] bg-white/[.025] text-[var(--althea-muted)]',
}

export function CRMOperatorWorkspace({
  conversationId,
  channel,
  onUseReply,
}: {
  conversationId: string
  channel: string
  onUseReply: (body: string) => void
}) {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPriority, setTaskPriority] = useState('normal')
  const [taskDueAt, setTaskDueAt] = useState('')

  const load = useCallback(async () => {
    setError('')
    const result = await db.rpc('crm_operator_workspace_v1', { p_conversation_id: conversationId })
    if (result.error) {
      setError(result.error.message)
      setLoading(false)
      return
    }
    const data = obj(result.data)
    setWorkspace({
      sla: Object.keys(obj(data.sla)).length ? obj(data.sla) : null,
      notes: arr(data.notes),
      tags: arr(data.tags),
      available_tags: arr(data.available_tags),
      tasks: arr(data.tasks),
      quick_replies: arr(data.quick_replies),
      identities: arr(data.identities),
      delivery_events: arr(data.delivery_events),
      outbox: arr(data.outbox),
    })
    setLoading(false)
  }, [conversationId, db])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    let timer: number | null = null
    const refresh = () => {
      if (!active || timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load()
      }, 350)
    }
    const realtime = db.channel(`crm-workspace:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversation_notes', filter: `conversation_id=eq.${conversationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversation_tags', filter: `conversation_id=eq.${conversationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `conversation_id=eq.${conversationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_channel_message_outbox', filter: `conversation_id=eq.${conversationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_channel_delivery_events', filter: `conversation_id=eq.${conversationId}` }, refresh)
      .subscribe()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(realtime)
    }
  }, [conversationId, db, load])

  const selectedTagIds = useMemo(
    () => new Set(workspace.tags.map(item => text(item.tag_id)).filter(Boolean)),
    [workspace.tags],
  )

  const addNote = async () => {
    const body = note.trim()
    if (!body || busy) return
    setBusy('note')
    const result = await db.rpc('crm_operator_add_note_v1', {
      p_conversation_id: conversationId,
      p_body: body,
    })
    if (result.error) setError(result.error.message)
    else {
      setNote('')
      await load()
    }
    setBusy('')
  }

  const toggleTag = async (tag: Json) => {
    const id = text(tag.id)
    if (!id || busy) return
    const enabled = !selectedTagIds.has(id)
    setBusy(`tag:${id}`)
    const result = await db.rpc('crm_operator_set_tag_v1', {
      p_conversation_id: conversationId,
      p_tag_id: id,
      p_enabled: enabled,
    })
    if (result.error) setError(result.error.message)
    else await load()
    setBusy('')
  }

  const createTask = async () => {
    const title = taskTitle.trim()
    if (!title || busy) return
    let dueAt: string | null = null
    if (taskDueAt) {
      const parsed = new Date(taskDueAt)
      if (!Number.isNaN(parsed.getTime())) dueAt = parsed.toISOString()
    }
    setBusy('task')
    const result = await db.rpc('crm_operator_create_task_v1', {
      p_conversation_id: conversationId,
      p_title: title,
      p_description: null,
      p_priority: taskPriority,
      p_due_at: dueAt,
    })
    if (result.error) setError(result.error.message)
    else {
      setTaskTitle('')
      setTaskDueAt('')
      setTaskPriority('normal')
      await load()
    }
    setBusy('')
  }

  const completeTask = async (taskId: string) => {
    if (!taskId || busy) return
    setBusy(`complete:${taskId}`)
    const result = await db.rpc('crm_complete_task', { p_task_id: taskId })
    if (result.error) setError(result.error.message)
    else await load()
    setBusy('')
  }

  const sla = workspace.sla ?? {}
  const slaState = text(sla.sla_state) || 'not_started'
  const failedOutbox = workspace.outbox.filter(item => ['failed', 'dead_letter'].includes(text(item.status)))

  return (
    <div className="mt-4 space-y-4">
      {error && (
        <div className="rounded-xl border border-red-400/15 bg-red-400/[.045] px-3 py-2 text-[10px] text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(item => <div key={item} className="h-16 animate-pulse rounded-xl bg-white/[.03]" />)}
        </div>
      ) : (
        <>
          <section className={`rounded-2xl border p-4 ${slaClass[slaState] || slaClass.not_started}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider">
                <Timer size={13} /> Atendimento
              </div>
              <strong className="text-[9px] uppercase">{slaLabel[slaState] || slaState}</strong>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
              <div><span className="block opacity-65">Limite 1ª resposta</span><b className="mt-1 block text-[10px]">{dateTime(sla.first_response_due_at)}</b></div>
              <div><span className="block opacity-65">Resposta registrada</span><b className="mt-1 block text-[10px]">{dateTime(sla.first_response_at)}</b></div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] p-4">
            <Header icon={Tag} title="Tags" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {workspace.available_tags.length === 0 ? <Empty text="Nenhuma tag cadastrada." /> : workspace.available_tags.map(tag => {
                const id = text(tag.id)
                const selected = selectedTagIds.has(id)
                return (
                  <button key={id} type="button" onClick={() => void toggleTag(tag)} disabled={Boolean(busy)} className={`rounded-full border px-2.5 py-1.5 text-[9px] font-semibold transition disabled:opacity-50 ${selected ? 'border-[rgba(29,184,84,.18)] bg-[rgba(29,184,84,.08)] text-[var(--althea-brand)]' : 'border-white/[.06] text-[var(--althea-muted)] hover:text-white'}`}>
                    {selected && <Check size={10} className="mr-1 inline" />}{text(tag.name)}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] p-4">
            <Header icon={Zap} title="Respostas rápidas" />
            <div className="mt-3 space-y-2">
              {workspace.quick_replies.length === 0 ? <Empty text={`Nenhuma resposta rápida para ${channel}.`} /> : workspace.quick_replies.slice(0, 12).map(reply => (
                <button key={text(reply.id)} type="button" onClick={() => onUseReply(text(reply.body))} className="w-full rounded-xl border border-white/[.05] bg-white/[.02] px-3 py-2.5 text-left transition hover:bg-white/[.04]">
                  <b className="block text-[10px] text-white">{text(reply.title)}</b>
                  <span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-[var(--althea-muted)]">{text(reply.body)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] p-4">
            <Header icon={StickyNote} title="Notas internas" />
            <div className="mt-3 flex gap-2">
              <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} maxLength={10000} placeholder="Registrar contexto interno..." className="min-w-0 flex-1 resize-none rounded-xl border border-white/[.055] bg-transparent p-2.5 text-[10px] outline-none placeholder:text-[var(--althea-muted)]" />
              <button type="button" onClick={() => void addNote()} disabled={!note.trim() || Boolean(busy)} className="self-end rounded-xl bg-[var(--althea-brand)] p-2.5 text-black disabled:opacity-40" aria-label="Adicionar nota"><Plus size={14} /></button>
            </div>
            <div className="mt-3 space-y-2">
              {workspace.notes.length === 0 ? <Empty text="Sem notas internas." /> : workspace.notes.slice(0, 10).map(item => (
                <div key={text(item.id)} className="rounded-xl border border-white/[.045] bg-white/[.02] p-3">
                  <p className="whitespace-pre-wrap text-[10px] leading-4 text-zinc-300">{text(item.body)}</p>
                  <span className="mt-2 block text-[8px] text-[var(--althea-muted)]">{dateTime(item.created_at)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] p-4">
            <Header icon={ListTodo} title="Tarefas" />
            <div className="mt-3 space-y-2">
              <input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} maxLength={200} placeholder="Nova tarefa..." className="h-9 w-full rounded-xl border border-white/[.055] bg-transparent px-3 text-[10px] outline-none placeholder:text-[var(--althea-muted)]" />
              <div className="grid grid-cols-[1fr_110px_36px] gap-2">
                <input type="datetime-local" value={taskDueAt} onChange={event => setTaskDueAt(event.target.value)} className="min-w-0 rounded-xl border border-white/[.055] bg-transparent px-2 text-[9px] outline-none" />
                <select value={taskPriority} onChange={event => setTaskPriority(event.target.value)} className="rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-2 text-[9px] outline-none">
                  <option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option>
                </select>
                <button type="button" onClick={() => void createTask()} disabled={!taskTitle.trim() || Boolean(busy)} className="grid place-items-center rounded-xl bg-[var(--althea-brand)] text-black disabled:opacity-40" aria-label="Criar tarefa"><Plus size={13} /></button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {workspace.tasks.length === 0 ? <Empty text="Sem tarefas." /> : workspace.tasks.slice(0, 20).map(item => {
                const status = text(item.status)
                const done = status === 'completed'
                return (
                  <div key={text(item.id)} className="flex items-start gap-2 rounded-xl border border-white/[.045] bg-white/[.02] p-3">
                    <button type="button" onClick={() => void completeTask(text(item.id))} disabled={done || Boolean(busy)} className="mt-0.5 text-[var(--althea-brand)] disabled:opacity-45" aria-label={done ? 'Tarefa concluída' : 'Concluir tarefa'}>
                      {done ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                    </button>
                    <div className="min-w-0 flex-1"><b className={`block truncate text-[10px] ${done ? 'text-[var(--althea-muted)] line-through' : 'text-zinc-200'}`}>{text(item.title)}</b><span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{text(item.priority)} · {item.due_at ? dateTime(item.due_at) : 'sem prazo'}</span></div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] p-4">
            <Header icon={UserRound} title="Identidades e canais" />
            <div className="mt-3 space-y-2">
              {workspace.identities.length === 0 ? <Empty text="Sem identidades vinculadas." /> : workspace.identities.slice(0, 12).map(item => (
                <div key={text(item.id)} className="rounded-xl border border-white/[.045] bg-white/[.02] p-3">
                  <div className="flex items-center justify-between gap-2"><b className="text-[10px] uppercase text-zinc-200">{text(item.channel)}</b><span className="text-[8px] text-[var(--althea-muted)]">{text(item.external_user_id)}</span></div>
                  <div className="mt-2 space-y-1 text-[9px] text-[var(--althea-muted)]">
                    {text(item.display_name) && <div>{text(item.display_name)}</div>}
                    {text(item.email) && <div className="flex items-center gap-1"><AtSign size={10} /> {text(item.email)}</div>}
                    {text(item.phone_e164) && <div>{text(item.phone_e164)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[.055] p-4">
            <Header icon={MessageSquareText} title="Entrega de mensagens" />
            {failedOutbox.length > 0 && (
              <div className="mt-3 rounded-xl border border-red-400/15 bg-red-400/[.04] p-3">
                <div className="flex items-center gap-2 text-[9px] font-semibold text-red-300"><AlertTriangle size={12} /> {failedOutbox.length} falha(s) no outbox</div>
                <p className="mt-1 line-clamp-2 text-[9px] text-red-200/80">{text(failedOutbox[0].last_error) || 'Falha de entrega sem mensagem detalhada.'}</p>
              </div>
            )}
            <div className="mt-3 space-y-2">
              {workspace.delivery_events.length === 0 ? <Empty text="Sem recibos de entrega." /> : workspace.delivery_events.slice(0, 8).map(item => (
                <div key={text(item.id)} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.045] bg-white/[.02] px-3 py-2.5">
                  <div className="min-w-0"><b className="block truncate text-[9px] text-zinc-300">{text(item.status)}</b><span className="block truncate text-[8px] text-[var(--althea-muted)]">{text(item.external_message_id)}</span></div>
                  <span className="shrink-0 text-[8px] text-[var(--althea-muted)]">{dateTime(item.occurred_at)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Header({ icon: Icon, title }: { icon: typeof Tag; title: string }) {
  return <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[var(--althea-muted)]"><Icon size={12} /> {title}</div>
}

function Empty({ text: value }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-white/[.05] px-3 py-3 text-center text-[9px] text-[var(--althea-muted)]">{value}</p>
}
