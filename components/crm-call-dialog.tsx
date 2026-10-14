'use client'

import { useEffect, useState } from 'react'
import { CreditCard, ListTodo, Loader2, MessageCircle, Phone, UserRound, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type Outcome = 'answered' | 'no_answer' | 'busy' | 'voicemail' | 'wrong_number' | 'callback' | 'converted' | 'not_interested'
type StageKind = 'open' | 'won' | 'lost'
type Member = { user_id: string; name: string | null }
type Attempt = { id: string; outcome: Outcome; notes: string | null; callback_at: string | null; created_by: string | null; created_at: string }
type ContextCard = { id: string; pipeline_name: string; stage_id: string; stage_name: string; version: number; owner_id: string | null; stages: { id: string; name: string; kind: StageKind }[] }
type CallContext = {
  client: { id: string; name: string | null; email: string | null; phone: string | null; origin_funnel_id: string | null }
  cards: ContextCard[]
  attempts: Attempt[]
  conversations: { id: string; status: string; channel: string; last_activity_at: string }[]
  tasks: { id: string; title: string; priority: string; due_at: string | null; assigned_to: string | null }[]
  transactions: { id: string; status: string; amount: number | null; currency: string; payment_method: string | null; created_at: string }[]
  members: Member[]
  can_view_chats: boolean
  can_view_values: boolean
}

export const OUTCOME_LABEL: Record<Outcome, string> = { answered: 'Atendeu', no_answer: 'Não atendeu', busy: 'Ocupado', voicemail: 'Caixa postal', wrong_number: 'Número errado', callback: 'Pediu retorno', converted: 'Fechou', not_interested: 'Sem interesse' }
const TX_LABEL: Record<string, string> = { created: 'Criada', pending: 'Pendente', approved: 'Aprovada', failed: 'Falhou', refunded: 'Reembolsada', chargeback: 'Chargeback', declined: 'Recusada', expired: 'Expirada' }
const ERRORS: Record<string, string> = {
  FORBIDDEN: 'Seu acesso não permite esta ação.',
  CARD_VERSION_CONFLICT: 'Outro membro mexeu neste card agora. Os dados foram atualizados; confira e registre de novo.',
  CALLBACK_AT_REQUIRED: 'Informe quando retornar a ligação.',
  CARD_NOT_FOUND: 'Este card não existe mais.',
  CLIENT_NOT_FOUND: 'Cliente não encontrado.',
  TASK_TITLE_INVALID: 'A tarefa precisa de um título de até 200 caracteres.',
}
const when = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const money = (amount: number, currency: string) => { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(amount) } catch { return `${currency} ${amount.toFixed(2)}` } }
export const callErrorMessage = (cause: unknown) => { const raw = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : ''; return ERRORS[raw] ?? 'Não foi possível concluir a operação.' }

const field = 'h-10 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm outline-none focus:border-emerald-500/40'
const label = 'text-[10px] font-bold uppercase tracking-widest text-slate-500'

// One dialog for every place that logs a call (Kanban, Atendimento): loads the customer's call
// context from crm_client_call_context_v1 and writes through crm_call_log (+ crm_task_save for follow-up).
export function CrmCallDialog({ clientId, cardId, onClose, onLogged }: { clientId: string; cardId?: string | null; onClose: () => void; onLogged: () => void }) {
  const [db] = useState(() => createSupabaseBrowserClient())
  const [ctx, setCtx] = useState<CallContext | null>(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attemptId] = useState(() => crypto.randomUUID())
  const [outcome, setOutcome] = useState<Outcome>('answered')
  const [notes, setNotes] = useState('')
  const [minutes, setMinutes] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [stageId, setStageId] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [logged, setLogged] = useState(false)

  async function load() {
    setLoadError('')
    const result = await db.rpc('crm_client_call_context_v1', { p_client_id: clientId })
    if (result.error) { setLoadError(callErrorMessage(result.error)); return }
    setCtx(result.data as CallContext)
  }
  useEffect(() => { void load() }, [clientId])

  const card = ctx?.cards.find(item => item.id === cardId) ?? ctx?.cards[0] ?? null
  const memberName = (id: string | null) => id ? ctx?.members.find(member => member.user_id === id)?.name || `Membro ${id.slice(0, 6)}` : 'Sem responsável'

  async function submit() {
    if (!ctx) return
    setSaving(true); setError('')
    // a retry after a failed task save must not log the call twice: the attempt id is fixed and the RPC replays it
    if (!logged) {
      const parsed = Number(minutes)
      const result = await db.rpc('crm_call_log', {
        p_attempt_id: attemptId, p_client_id: clientId, p_outcome: outcome, p_notes: notes || null,
        p_duration_seconds: minutes && Number.isFinite(parsed) ? Math.round(parsed * 60) : null,
        p_callback_at: outcome === 'callback' && callbackAt ? new Date(callbackAt).toISOString() : null,
        p_card_id: card?.id ?? null, p_stage_id: stageId || null, p_expected_version: card?.version ?? null,
      })
      if (result.error) { setSaving(false); setError(callErrorMessage(result.error)); await load(); return }
      setLogged(true)
    }
    if (taskTitle.trim()) {
      const task = await db.rpc('crm_task_save', { p_id: null, p_title: taskTitle.trim(), p_priority: 'normal', p_due_at: taskDue ? new Date(taskDue).toISOString() : null, p_client_id: clientId })
      if (task.error) { setSaving(false); setError(`Ligação registrada, mas a tarefa não foi criada: ${callErrorMessage(task.error)}`); return }
    }
    setSaving(false)
    onLogged()
  }

  return <div role="dialog" aria-modal="true" aria-label="Registrar ligação" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-6" onClick={event => { if (event.currentTarget === event.target) onClose() }}>
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b100e] p-6 md:rounded-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-black">{ctx?.client.name || 'Cliente sem nome'}</h2>
          {ctx && (ctx.client.phone ? <a href={`tel:${ctx.client.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"><Phone size={13} /> {ctx.client.phone}</a> : <span className="text-sm text-slate-500">Cliente sem telefone cadastrado</span>)}
          {ctx?.client.email && <span className="block truncate text-xs text-slate-500">{ctx.client.email}</span>}
          {card && <span className="mt-1 block text-xs text-slate-400">{card.pipeline_name} · {card.stage_name} · {memberName(card.owner_id)}</span>}
        </div>
        <div className="flex items-center gap-1">
          {ctx?.conversations[0] && <>
            <a href={`/dashboard/crm?conversation=${ctx.conversations[0].id}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5"><MessageCircle size={13} /> Conversa</a>
            <a href={`/dashboard/crm/customer-360?conversation=${ctx.conversations[0].id}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5"><UserRound size={13} /> 360°</a>
          </>}
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-white/5"><X size={18} /></button>
        </div>
      </div>

      {loadError && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">{loadError} <button type="button" onClick={() => void load()} className="underline">Tentar de novo</button></div>}
      {!ctx && !loadError && <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin text-emerald-400" /> Carregando cliente</div>}

      {ctx && <div className="grid gap-6 md:grid-cols-[1fr_.9fr]">
        <div>
          <fieldset className="mb-4" disabled={logged}><legend className={`mb-2 ${label}`}>Resultado</legend>
            <div className="grid grid-cols-2 gap-2">{(Object.keys(OUTCOME_LABEL) as Outcome[]).map(item => <button key={item} type="button" aria-pressed={outcome === item} onClick={() => setOutcome(item)} className={`h-9 rounded-lg border text-sm ${outcome === item ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-300 hover:bg-white/[.04]'}`}>{OUTCOME_LABEL[item]}</button>)}</div>
          </fieldset>
          {outcome === 'callback' && <label className="mb-4 block space-y-1"><span className={label}>Retornar em</span><input type="datetime-local" required disabled={logged} value={callbackAt} onChange={event => setCallbackAt(event.target.value)} className={field} /></label>}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <label className="block space-y-1"><span className={label}>Duração (min)</span><input type="number" min={0} step="0.5" inputMode="decimal" disabled={logged} value={minutes} onChange={event => setMinutes(event.target.value)} className={field} /></label>
            <label className="block space-y-1"><span className={label}>Mover para</span><select value={stageId} disabled={logged || !card} onChange={event => setStageId(event.target.value)} className={`${field} bg-[#0b100e] px-2`}><option value="">{!card ? 'Fora do Kanban' : outcome === 'converted' ? 'Etapa de ganho' : outcome === 'not_interested' ? 'Etapa de perda' : 'Manter etapa'}</option>{card?.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
          </div>
          <label className="mb-4 block space-y-1"><span className={label}>Anotações</span><textarea value={notes} disabled={logged} maxLength={2000} rows={3} onChange={event => setNotes(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-sm outline-none focus:border-emerald-500/40" /></label>
          {ctx.can_view_chats && <div className="mb-4 grid grid-cols-[1fr_auto] gap-2">
            <label className="block space-y-1"><span className={label}>Tarefa de follow-up (opcional)</span><input value={taskTitle} maxLength={200} onChange={event => setTaskTitle(event.target.value)} placeholder="Ex.: Enviar proposta" className={field} /></label>
            <label className="block space-y-1"><span className={label}>Prazo</span><input type="datetime-local" value={taskDue} onChange={event => setTaskDue(event.target.value)} className={field} /></label>
          </div>}
          {error && <div role="alert" className="mb-3 rounded-xl border border-red-500/20 bg-red-500/[.06] px-3 py-2 text-sm text-red-300">{error}</div>}
          <button type="button" onClick={() => void submit()} disabled={saving || (outcome === 'callback' && !callbackAt)} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />} {logged ? 'Criar tarefa' : 'Registrar ligação'}</button>
        </div>

        <div className="space-y-5 text-xs">
          <section><h3 className={`mb-2 ${label}`}>Últimas ligações</h3>
            {ctx.attempts.length ? <ul className="space-y-2">{ctx.attempts.slice(0, 6).map(item => <li key={item.id} className="rounded-lg border border-white/[.06] px-3 py-2"><div className="flex justify-between gap-2"><b className="text-slate-300">{OUTCOME_LABEL[item.outcome]}</b><span className="text-slate-600">{when(item.created_at)}</span></div><span className="text-slate-600">{memberName(item.created_by)}</span>{item.notes && <p className="pt-1 text-slate-500">{item.notes}</p>}{item.callback_at && <p className="pt-1 text-amber-400">retornar {when(item.callback_at)}</p>}</li>)}</ul> : <p className="text-slate-600">Nenhuma ligação ainda.</p>}
          </section>
          {ctx.can_view_chats && <section><h3 className={`mb-2 flex items-center gap-1 ${label}`}><ListTodo size={12} /> Tarefas abertas</h3>
            {ctx.tasks.length ? <ul className="space-y-1">{ctx.tasks.map(task => <li key={task.id} className="flex justify-between gap-2 rounded-lg border border-white/[.06] px-3 py-1.5"><span className="truncate text-slate-300">{task.title}</span>{task.due_at && <span className={new Date(task.due_at) < new Date() ? 'text-red-400' : 'text-slate-600'}>{when(task.due_at)}</span>}</li>)}</ul> : <p className="text-slate-600">Sem tarefas abertas.</p>}
          </section>}
          <section><h3 className={`mb-2 flex items-center gap-1 ${label}`}><CreditCard size={12} /> Transações</h3>
            {ctx.transactions.length ? <ul className="space-y-1">{ctx.transactions.map(tx => <li key={tx.id}><a href={`/dashboard/pagamentos?transaction=${tx.id}`} className="flex justify-between gap-2 rounded-lg border border-white/[.06] px-3 py-1.5 hover:bg-white/[.03]"><span className="text-slate-300">{TX_LABEL[tx.status] ?? tx.status}{tx.payment_method ? ` · ${tx.payment_method}` : ''}</span><span className="text-slate-500">{tx.amount != null ? money(Number(tx.amount), tx.currency) : when(tx.created_at)}</span></a></li>)}</ul> : <p className="text-slate-600">Nenhuma transação encontrada para este cliente.</p>}
          </section>
        </div>
      </div>}
    </div>
  </div>
}
