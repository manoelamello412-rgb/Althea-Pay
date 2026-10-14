'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, ListTodo, Loader2, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hasOrganizationCapability, parseOrganizationAccess, type OrganizationAccess } from '@/lib/auth/organization-access'

type Status = 'open' | 'in_progress' | 'completed' | 'cancelled'
type Priority = 'low' | 'normal' | 'high' | 'urgent'
type Task = { id: string; title: string; description: string | null; status: Status; priority: Priority; due_at: string | null; assigned_to: string | null; conversation_id: string | null; client_id: string | null; completed_at: string | null; created_at: string }
type Member = { user_id: string; name: string }
type Draft = { id: string | null; title: string; description: string; priority: Priority; due: string; assignedTo: string; conversationId: string | null; clientId: string | null }

const STATUS_LABEL: Record<Status, string> = { open: 'Aberta', in_progress: 'Em andamento', completed: 'Concluída', cancelled: 'Cancelada' }
const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const PRIORITY_TONE: Record<Priority, string> = { low: 'text-slate-500', normal: 'text-slate-300', high: 'text-amber-400', urgent: 'text-red-400' }
const FILTERS = [['pending', 'Pendentes'], ['mine', 'Minhas'], ['completed', 'Concluídas'], ['all', 'Todas']] as const
type Filter = (typeof FILTERS)[number][0]
const ERRORS: Record<string, string> = { FORBIDDEN: 'Seu acesso não permite alterar tarefas.', TASK_TITLE_INVALID: 'Informe um título de até 200 caracteres.', ASSIGNEE_NOT_MEMBER: 'O responsável precisa ser membro da organização.', TASK_NOT_FOUND: 'Tarefa não encontrada.' }

const messageOf = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível salvar a tarefa.' }
const toLocalInput = (value: string | null) => { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
const dueLabel = (task: Task) => {
  if (!task.due_at) return null
  const due = new Date(task.due_at)
  const late = due.getTime() < Date.now() && (task.status === 'open' || task.status === 'in_progress')
  return { text: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(due), late }
}

export default function TarefasPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [access, setAccess] = useState<OrganizationAccess | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [filter, setFilter] = useState<Filter>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const canWrite = hasOrganizationCapability(access, 'can_reply_chats')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const accessResult = await db.rpc('organization_my_access_v1', { p_organization_id: null })
      if (accessResult.error) throw accessResult.error
      const current = parseOrganizationAccess(accessResult.data)
      setAccess(current)
      if (!current) return
      const [taskResult, memberResult] = await Promise.all([
        db.from('crm_tasks').select('id,title,description,status,priority,due_at,assigned_to,conversation_id,client_id,completed_at,created_at').eq('organization_id', current.organization_id).order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(500),
        db.from('organization_members').select('user_id').eq('organization_id', current.organization_id),
      ])
      if (taskResult.error) throw taskResult.error
      if (memberResult.error) throw memberResult.error
      setTasks((taskResult.data ?? []) as Task[])
      const ids = ((memberResult.data ?? []) as { user_id: string }[]).map(row => row.user_id)
      const profileResult = ids.length ? await db.from('profiles').select('id,display_name').in('id', ids) : { data: [], error: null }
      const names = new Map(((profileResult.data ?? []) as { id: string; display_name: string | null }[]).map(row => [row.id, row.display_name]))
      setMembers(ids.map(id => ({ user_id: id, name: names.get(id) || (id === current.user_id ? 'Você' : `Membro ${id.slice(0, 6)}`) })))
    } catch (cause) {
      console.error('[ALTHEA-TAREFAS]', cause)
      setError('Não foi possível carregar as tarefas.')
    } finally { setLoading(false) }
  }, [db])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!access) return
    const channel = db.channel(`tasks-${access.organization_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `organization_id=eq.${access.organization_id}` }, () => void load())
      .subscribe()
    return () => { void db.removeChannel(channel) }
  }, [access, db, load])

  const rows = tasks.filter(task => {
    if (filter === 'completed') return task.status === 'completed'
    if (filter === 'all') return true
    const pending = task.status === 'open' || task.status === 'in_progress'
    return filter === 'mine' ? pending && task.assigned_to === access?.user_id : pending
  })
  const memberName = (id: string | null) => id ? members.find(member => member.user_id === id)?.name ?? 'Membro removido' : 'Sem responsável'

  async function setStatus(task: Task, status: Status) {
    setError('')
    const result = await db.rpc('crm_task_set_status', { p_id: task.id, p_status: status })
    if (result.error) { setError(messageOf(result.error)); return }
    setTasks(current => current.map(item => item.id === task.id ? result.data as Task : item))
  }

  async function save() {
    if (!draft) return
    setSaving(true); setError('')
    const result = await db.rpc('crm_task_save', { p_id: draft.id, p_title: draft.title, p_description: draft.description, p_priority: draft.priority, p_due_at: draft.due ? new Date(draft.due).toISOString() : null, p_assigned_to: draft.assignedTo || null, p_conversation_id: draft.conversationId, p_client_id: draft.clientId })
    setSaving(false)
    if (result.error) { setError(messageOf(result.error)); return }
    setDraft(null)
    await load()
  }

  return <main className="min-h-screen bg-[#070A09] px-4 py-6 text-slate-100 lg:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><div className="mb-2 text-[10px] font-black uppercase tracking-[.28em] text-emerald-400">ALTHEA PAY // TAREFAS</div><h1 className="text-3xl font-black tracking-tight">Tarefas</h1><p className="mt-1 text-sm text-slate-500">Follow-ups da equipe, com responsável e prazo.</p></div>
        <div className="flex gap-2">
          {canWrite && <button type="button" onClick={() => setDraft({ id: null, title: '', description: '', priority: 'normal', due: '', assignedTo: access?.user_id ?? '', conversationId: null, clientId: null })} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-black hover:bg-emerald-400"><Plus size={15} /> Nova tarefa</button>}
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[.03] px-3 hover:bg-white/[.06] disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <div role="tablist" aria-label="Filtro" className="mb-4 flex flex-wrap gap-1">{FILTERS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === id ? 'bg-white/[.08] text-white' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>)}</div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.02]">
        {loading && !tasks.length ? <div className="flex min-h-48 items-center justify-center gap-2 text-slate-500"><Loader2 size={18} className="animate-spin text-emerald-400" /> Carregando tarefas</div>
          : !rows.length ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center"><ListTodo size={24} className="text-slate-600" /><strong>Nada por aqui</strong><p className="text-sm text-slate-600">{tasks.length ? 'Nenhuma tarefa neste filtro.' : 'Crie a primeira tarefa da equipe.'}</p></div>
          : rows.map(task => {
            const due = dueLabel(task)
            const done = task.status === 'completed'
            return <article key={task.id} className="flex items-start gap-3 border-b border-white/[.06] px-4 py-3 last:border-0">
              <button type="button" disabled={!canWrite} onClick={() => void setStatus(task, done ? 'open' : 'completed')} aria-label={done ? 'Reabrir tarefa' : 'Concluir tarefa'} className="mt-0.5 text-slate-500 hover:text-emerald-400 disabled:cursor-default">{done ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} />}</button>
              <div className="min-w-0 flex-1">
                <b className={`block text-sm ${done ? 'text-slate-500 line-through' : ''}`}>{task.title}</b>
                {task.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{task.description}</p>}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500"><span className={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</span><span>{memberName(task.assigned_to)}</span>{due && <span className={due.late ? 'text-red-400' : ''}>{due.late ? 'Atrasada · ' : ''}{due.text}</span>}{task.client_id ? <span>Ligada a um cliente</span> : task.conversation_id && <span>Ligada a uma conversa</span>}</div>
              </div>
              {canWrite && <div className="flex shrink-0 items-center gap-1">
                <select aria-label={`Status de ${task.title}`} value={task.status} onChange={event => void setStatus(task, event.target.value as Status)} className="rounded-md border border-white/10 bg-[#0b100e] px-1.5 py-1 text-[11px] text-slate-400">{(Object.keys(STATUS_LABEL) as Status[]).map(status => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}</select>
                <button type="button" aria-label={`Editar ${task.title}`} onClick={() => setDraft({ id: task.id, title: task.title, description: task.description ?? '', priority: task.priority, due: toLocalInput(task.due_at), assignedTo: task.assigned_to ?? '', conversationId: task.conversation_id, clientId: task.client_id })} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"><Pencil size={14} /></button>
              </div>}
            </article>
          })}
      </section>
    </div>

    {draft && <div role="dialog" aria-modal="true" aria-label={draft.id ? 'Editar tarefa' : 'Nova tarefa'} className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) setDraft(null) }}>
      <div className="w-full max-w-lg rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-black">{draft.id ? 'Editar tarefa' : 'Nova tarefa'}</h2><button type="button" onClick={() => setDraft(null)} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button></div>
        <div className="space-y-3">
          <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Título</span><input value={draft.title} maxLength={200} onChange={event => setDraft({ ...draft, title: event.target.value })} className="h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40" /></label>
          <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Descrição</span><textarea value={draft.description} maxLength={5000} rows={3} onChange={event => setDraft({ ...draft, description: event.target.value })} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Prioridade</span><select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as Priority })} className="h-10 w-full rounded-xl border border-white/10 bg-[#0b100e] px-3 text-sm">{(Object.keys(PRIORITY_LABEL) as Priority[]).map(priority => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}</select></label>
            <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Prazo</span><input type="datetime-local" value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })} className="h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm [color-scheme:dark]" /></label>
          </div>
          <label className="block space-y-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Responsável</span><select value={draft.assignedTo} onChange={event => setDraft({ ...draft, assignedTo: event.target.value })} className="h-10 w-full rounded-xl border border-white/10 bg-[#0b100e] px-3 text-sm"><option value="">Sem responsável</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}</select></label>
        </div>
        <button type="button" onClick={() => void save()} disabled={saving || !draft.title.trim()} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} Salvar</button>
      </div>
    </div>}
  </main>
}
