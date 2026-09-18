'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Workflow,
  X,
  XCircle,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Json = Record<string, unknown>

type AutomationMetrics = {
  rules: number
  active_rules: number
  draft_rules: number
  paused_rules: number
  executions_24h: number
  completed_24h: number
  failed_24h: number
  dead_letter: number
  scheduled_or_pending: number
}

type AutomationRule = {
  id: string
  name: string
  status: 'draft' | 'active' | 'paused'
  trigger_config: Json
  action_config: Json
  created_at: string
  updated_at: string
  executions_24h: number
  completed_24h: number
  failed_24h: number
  last_status: string | null
  last_execution_at: string | null
}

type AutomationExecution = {
  id: string
  rule_id: string
  rule_name: string
  status: string
  action_type: string | null
  event_id: string | null
  execution_key: string
  error_message: string | null
  attempt_count: number
  max_attempts: number
  next_retry_at: string | null
  scheduled_at: string | null
  dead_lettered_at: string | null
  cancelled_at: string | null
  replay_count: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  attempts: number
  event_type: string | null
  funnel_id: string | null
}

type EventType = { event_type: string; protocol_version: string }
type Funnel = { id: string; name: string }

type OperationsPayload = {
  metrics: AutomationMetrics
  rules: AutomationRule[]
  executions: AutomationExecution[]
  event_types: EventType[]
  funnels: Funnel[]
  capabilities: Json
}

type ConditionDraft = {
  id: string
  field: string
  operator: string
  value: string
}

type ActionDraft = {
  id: string
  type: 'log' | 'alert' | 'send_crm_message' | 'set_conversation_status'
  body: string
  conversationStatus: 'open' | 'pending' | 'closed'
}

const EMPTY_METRICS: AutomationMetrics = {
  rules: 0,
  active_rules: 0,
  draft_rules: 0,
  paused_rules: 0,
  executions_24h: 0,
  completed_24h: 0,
  failed_24h: 0,
  dead_letter: 0,
  scheduled_or_pending: 0,
}

const CONDITION_OPERATORS = [
  ['eq', 'Igual a'],
  ['neq', 'Diferente de'],
  ['contains', 'Contém'],
  ['icontains', 'Contém (ignora maiúsculas)'],
  ['starts_with', 'Começa com'],
  ['ends_with', 'Termina com'],
  ['gt', 'Maior que'],
  ['gte', 'Maior ou igual'],
  ['lt', 'Menor que'],
  ['lte', 'Menor ou igual'],
  ['exists', 'Existe'],
  ['is_null', 'É vazio'],
  ['is_not_null', 'Não é vazio'],
] as const

const ACTION_LABELS: Record<ActionDraft['type'], string> = {
  log: 'Registrar log',
  alert: 'Registrar alerta',
  send_crm_message: 'Enviar mensagem no chat do funil',
  set_conversation_status: 'Alterar status da conversa',
}

const objectOf = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}

const arrayOfObjects = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Json[] : []

const stringOf = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : String(value)

const numberOf = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const dateTime = (value: unknown): string => {
  const parsed = new Date(stringOf(value))
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

const uid = () => crypto.randomUUID()

function statusClass(status: string | null | undefined): string {
  const value = String(status ?? '').toLowerCase()
  if (['active', 'completed', 'success'].includes(value)) {
    return 'border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] text-[#78d899]'
  }
  if (['failed', 'dead_letter', 'error'].includes(value)) {
    return 'border-red-400/15 bg-red-400/[.05] text-red-300'
  }
  if (['scheduled', 'pending', 'running', 'draft'].includes(value)) {
    return 'border-[rgba(212,175,55,.18)] bg-[rgba(212,175,55,.055)] text-[#D4AF37]'
  }
  return 'border-white/[.055] bg-white/[.02] text-[var(--althea-muted)]'
}

function statusLabel(status: string | null | undefined): string {
  const value = String(status ?? '').toLowerCase()
  const labels: Record<string, string> = {
    active: 'Ativa',
    paused: 'Pausada',
    draft: 'Rascunho',
    completed: 'Concluída',
    failed: 'Falhou',
    dead_letter: 'Dead letter',
    pending: 'Pendente',
    scheduled: 'Agendada',
    running: 'Executando',
    cancelled: 'Cancelada',
    skipped: 'Ignorada',
  }
  return labels[value] || value || '—'
}

function parseConditionValue(operator: string, raw: string): unknown {
  if (['is_null', 'is_not_null'].includes(operator)) return null
  if (operator === 'exists') return raw !== 'false'
  const clean = raw.trim()
  if (clean === 'true') return true
  if (clean === 'false') return false
  if (clean !== '' && /^-?\d+(\.\d+)?$/.test(clean)) return Number(clean)
  return clean
}

function newAction(): ActionDraft {
  return { id: uid(), type: 'log', body: '', conversationStatus: 'open' }
}

function newCondition(): ConditionDraft {
  return { id: uid(), field: '', operator: 'eq', value: '' }
}

export default function AutomationsPage() {
  const db = useMemo(() => createSupabaseBrowserClient(), [])
  const [payload, setPayload] = useState<OperationsPayload | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [ruleStatus, setRuleStatus] = useState<'draft' | 'active' | 'paused'>('draft')
  const [eventType, setEventType] = useState('*')
  const [funnelId, setFunnelId] = useState('*')
  const [logical, setLogical] = useState<'and' | 'or'>('and')
  const [conditions, setConditions] = useState<ConditionDraft[]>([])
  const [actions, setActions] = useState<ActionDraft[]>([newAction()])

  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true)
    setError('')
    try {
      const result = await db.rpc('automation_operations_v1', { p_limit: 100 })
      if (result.error) throw result.error
      const data = objectOf(result.data)
      const metrics = objectOf(data.metrics)
      setPayload({
        metrics: {
          rules: numberOf(metrics.rules),
          active_rules: numberOf(metrics.active_rules),
          draft_rules: numberOf(metrics.draft_rules),
          paused_rules: numberOf(metrics.paused_rules),
          executions_24h: numberOf(metrics.executions_24h),
          completed_24h: numberOf(metrics.completed_24h),
          failed_24h: numberOf(metrics.failed_24h),
          dead_letter: numberOf(metrics.dead_letter),
          scheduled_or_pending: numberOf(metrics.scheduled_or_pending),
        },
        rules: Array.isArray(data.rules) ? data.rules as AutomationRule[] : [],
        executions: Array.isArray(data.executions) ? data.executions as AutomationExecution[] : [],
        event_types: Array.isArray(data.event_types) ? data.event_types as EventType[] : [],
        funnels: Array.isArray(data.funnels) ? data.funnels as Funnel[] : [],
        capabilities: objectOf(data.capabilities),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as automações.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [db])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    let active = true
    void db.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      const profile = await db.from('profiles')
        .select('default_organization_id')
        .eq('id', data.user.id)
        .single()
      if (active && !profile.error && profile.data?.default_organization_id) {
        setOrganizationId(String(profile.data.default_organization_id))
      }
    })
    return () => { active = false }
  }, [db])

  useEffect(() => {
    if (!organizationId) return
    let timer: number | null = null
    const refresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void load(false)
      }, 500)
    }

    const channel = db.channel(`automation-operations-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_rules', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_executions', filter: `organization_id=eq.${organizationId}` }, refresh)
      .subscribe()

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      void db.removeChannel(channel)
    }
  }, [db, load, organizationId])

  const resetEditor = () => {
    setEditingRuleId(null)
    setName('')
    setRuleStatus('draft')
    setEventType('*')
    setFunnelId('*')
    setLogical('and')
    setConditions([])
    setActions([newAction()])
    setError('')
  }

  const openCreate = () => {
    resetEditor()
    setEditorOpen(true)
  }

  const openEdit = (rule: AutomationRule) => {
    const trigger = objectOf(rule.trigger_config)
    const conditionRows = arrayOfObjects(trigger.conditions).map(item => ({
      id: uid(),
      field: stringOf(item.field),
      operator: stringOf(item.operator) || 'eq',
      value: item.value == null ? '' : String(item.value),
    })).filter(item => item.field)

    const config = objectOf(rule.action_config)
    const rawActions = Array.isArray(config.actions) ? arrayOfObjects(config.actions) : [config]
    const actionRows = rawActions.map(item => {
      const type = stringOf(item.type || item.action) as ActionDraft['type']
      const supported: ActionDraft['type'] = ['log', 'alert', 'send_crm_message', 'set_conversation_status'].includes(type)
        ? type
        : 'log'
      return {
        id: uid(),
        type: supported,
        body: stringOf(item.body || item.message),
        conversationStatus: (['open', 'pending', 'closed'].includes(stringOf(item.status))
          ? stringOf(item.status)
          : 'open') as ActionDraft['conversationStatus'],
      }
    }).slice(0, 5)

    setEditingRuleId(rule.id)
    setName(rule.name)
    setRuleStatus(rule.status)
    setEventType(stringOf(trigger.event_type) || '*')
    setFunnelId(stringOf(trigger.funnel_id) || '*')
    setLogical(stringOf(trigger.logical).toLowerCase() === 'or' ? 'or' : 'and')
    setConditions(conditionRows)
    setActions(actionRows.length ? actionRows : [newAction()])
    setError('')
    setEditorOpen(true)
  }

  const buildConfigs = () => {
    const normalizedConditions = conditions
      .filter(item => item.field.trim())
      .map(item => ({
        field: item.field.trim(),
        operator: item.operator,
        value: parseConditionValue(item.operator, item.value),
      }))

    const trigger: Json = {
      event_type: eventType || '*',
      funnel_id: funnelId || '*',
    }
    if (normalizedConditions.length) {
      trigger.conditions = normalizedConditions
      trigger.logical = logical
    }

    const normalizedActions = actions.map(action => {
      if (action.type === 'send_crm_message') {
        return { type: action.type, channel: 'funnel_chat', body: action.body.trim() }
      }
      if (action.type === 'set_conversation_status') {
        return { type: action.type, status: action.conversationStatus }
      }
      return { type: action.type }
    })

    const actionConfig: Json = {
      actions: normalizedActions,
      stop_on_error: true,
    }

    return { trigger, actionConfig }
  }

  const saveRule = async () => {
    if (saving) return
    if (!name.trim()) {
      setError('Informe um nome para a automação.')
      return
    }
    if (conditions.some(item => !item.field.trim())) {
      setError('Preencha ou remova as condições incompletas.')
      return
    }
    if (actions.some(item => item.type === 'send_crm_message' && !item.body.trim())) {
      setError('Informe a mensagem das ações de chat.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { trigger, actionConfig } = buildConfigs()
      const result = await db.rpc('automation_rule_upsert_v1', {
        p_rule_id: editingRuleId,
        p_name: name.trim(),
        p_status: ruleStatus,
        p_trigger_config: trigger,
        p_action_config: actionConfig,
      })
      if (result.error) throw result.error
      setMessage(editingRuleId ? 'Automação atualizada.' : 'Automação criada.')
      setEditorOpen(false)
      resetEditor()
      await load(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a automação.')
    } finally {
      setSaving(false)
    }
  }

  const changeRuleStatus = async (rule: AutomationRule, status: 'active' | 'paused') => {
    setError('')
    setMessage('')
    try {
      const result = await db.rpc('automation_rule_upsert_v1', {
        p_rule_id: rule.id,
        p_name: rule.name,
        p_status: status,
        p_trigger_config: rule.trigger_config,
        p_action_config: rule.action_config,
      })
      if (result.error) throw result.error
      setMessage(status === 'active' ? 'Automação ativada.' : 'Automação pausada.')
      await load(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o status.')
    }
  }

  const removeRule = async (rule: AutomationRule) => {
    if (!window.confirm(`Remover a automação “${rule.name}”? Se houver histórico de execução, ela será preservada como pausada.`)) return
    setError('')
    setMessage('')
    try {
      const result = await db.rpc('automation_rule_delete_v1', { p_rule_id: rule.id })
      if (result.error) throw result.error
      setMessage(result.data === true ? 'Automação removida.' : 'A automação possui histórico e foi pausada para preservar a auditoria.')
      await load(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível remover a automação.')
    }
  }

  const replayExecution = async (execution: AutomationExecution) => {
    setError('')
    setMessage('')
    try {
      const result = await db.rpc('crm_replay_automation_execution', {
        p_execution_id: execution.id,
        p_reason: 'manual replay from automation control plane',
      })
      if (result.error) throw result.error
      setMessage('Execução enviada novamente para a fila.')
      await load(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível reenviar a execução.')
    }
  }

  const cancelExecution = async (execution: AutomationExecution) => {
    if (!window.confirm('Cancelar esta execução pendente?')) return
    setError('')
    setMessage('')
    try {
      const result = await db.rpc('crm_cancel_automation_execution', {
        p_execution_id: execution.id,
        p_reason: 'manual cancellation from automation control plane',
      })
      if (result.error) throw result.error
      setMessage('Execução cancelada.')
      await load(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar a execução.')
    }
  }

  const metrics = payload?.metrics ?? EMPTY_METRICS
  const rules = payload?.rules ?? []
  const executions = payload?.executions ?? []
  const successRate = metrics.executions_24h > 0
    ? Math.round(metrics.completed_24h / metrics.executions_24h * 100)
    : 0

  return (
    <div className="w-full space-y-5">
      <section className="flex flex-col gap-5 border-b border-white/[.055] pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--althea-brand)]">
            <Workflow size={13} /> Revenue Automation
          </p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-.04em] text-white sm:text-[34px]">Automações</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--althea-muted)]">
            Regras tenant-scoped disparadas por eventos reais, com idempotência, retry, dead-letter e auditoria. Alterações financeiras continuam sob autoridade dos módulos de Payment/Gateway.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={refreshing}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.055] bg-[var(--althea-surface)] text-[var(--althea-muted)] hover:text-white disabled:opacity-50"
            aria-label="Atualizar automações"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] shadow-[0_8px_28px_rgba(29,184,84,.14)] transition hover:brightness-110"
          >
            <Plus size={14} /> Nova automação
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/15 bg-red-400/[.05] px-4 py-3 text-xs text-red-200">
          <XCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-[rgba(29,184,84,.16)] bg-[rgba(29,184,84,.055)] px-4 py-3 text-xs text-[#8edca5]">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Workflow} label="Regras" value={metrics.rules} note={`${metrics.active_rules} ativas`} />
        <Metric icon={Activity} label="Execuções · 24h" value={metrics.executions_24h} note={`${metrics.completed_24h} concluídas`} />
        <Metric icon={CheckCircle2} label="Sucesso · 24h" value={successRate} suffix="%" note="execuções concluídas" />
        <Metric icon={AlertTriangle} label="Falhas · 24h" value={metrics.failed_24h} warning={metrics.failed_24h > 0} note="inclui dead-letter" />
        <Metric icon={RotateCcw} label="Dead letter" value={metrics.dead_letter} warning={metrics.dead_letter > 0} note={`${metrics.scheduled_or_pending} na fila`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Regras</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Configuração persistida e governada por organização.</p>
            </div>
            <Settings2 size={16} className="text-[var(--althea-brand)]" />
          </div>

          {loading ? (
            <Skeleton />
          ) : rules.length === 0 ? (
            <EmptyState onCreate={openCreate} />
          ) : (
            <div className="mt-4 space-y-2">
              {rules.map(rule => {
                const trigger = objectOf(rule.trigger_config)
                const config = objectOf(rule.action_config)
                const actionRows = Array.isArray(config.actions) ? arrayOfObjects(config.actions) : [config]
                return (
                  <div key={rule.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-[11px] font-semibold text-white">{rule.name}</h3>
                          <Badge value={rule.status} />
                        </div>
                        <p className="mt-2 text-[8px] text-[var(--althea-muted)]">
                          Evento: <b className="text-zinc-300">{stringOf(trigger.event_type) || '*'}</b>
                          {' · '}Funil: <b className="text-zinc-300">{funnelName(payload?.funnels ?? [], stringOf(trigger.funnel_id))}</b>
                          {' · '}{actionRows.length} ação(ões)
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <button type="button" onClick={() => openEdit(rule)} className="rounded-lg border border-white/[.055] px-2.5 py-2 text-[8px] text-zinc-300 hover:text-white">Editar</button>
                        {rule.status === 'active' ? (
                          <button type="button" onClick={() => void changeRuleStatus(rule, 'paused')} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[.055] text-[#D4AF37]" aria-label="Pausar"><Pause size={11} /></button>
                        ) : (
                          <button type="button" onClick={() => void changeRuleStatus(rule, 'active')} className="grid h-8 w-8 place-items-center rounded-lg border border-white/[.055] text-[var(--althea-brand)]" aria-label="Ativar"><Play size={11} /></button>
                        )}
                        <button type="button" onClick={() => void removeRule(rule)} className="grid h-8 w-8 place-items-center rounded-lg border border-red-400/10 text-red-300/75 hover:text-red-200" aria-label="Remover"><Trash2 size={11} /></button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Mini label="Execuções 24h" value={rule.executions_24h} />
                      <Mini label="Concluídas" value={rule.completed_24h} />
                      <Mini label="Falhas" value={rule.failed_24h} warning={rule.failed_24h > 0} />
                    </div>
                    <p className="mt-2 text-[8px] text-[#5f6e66]">Última execução: {dateTime(rule.last_execution_at)} · {statusLabel(rule.last_status)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Execuções recentes</h2>
              <p className="mt-1 text-[10px] text-[var(--althea-muted)]">Fila, tentativas, retry e dead-letter reais.</p>
            </div>
            <Clock3 size={16} className="text-[var(--althea-brand)]" />
          </div>

          {loading ? (
            <Skeleton />
          ) : executions.length === 0 ? (
            <div className="mt-4 grid min-h-[260px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] p-6 text-center">
              <div><Activity size={22} className="mx-auto text-[var(--althea-brand)] opacity-70" /><p className="mt-3 text-[10px] text-zinc-300">Nenhuma execução registrada.</p><p className="mt-1 text-[8px] text-[var(--althea-muted)]">Uma regra só aparece aqui depois que um evento real a acionar.</p></div>
            </div>
          ) : (
            <div className="mt-4 max-h-[650px] space-y-2 overflow-y-auto pr-1">
              {executions.map(execution => (
                <div key={execution.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="truncate text-[10px] text-white">{execution.rule_name}</b>
                        <Badge value={execution.status} />
                      </div>
                      <p className="mt-1 text-[8px] text-[var(--althea-muted)]">{execution.event_type || 'evento interno'} · {execution.action_type || 'ação'} · {dateTime(execution.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {execution.status === 'dead_letter' && (
                        <button type="button" onClick={() => void replayExecution(execution)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[rgba(29,184,84,.12)] px-2 text-[8px] text-[var(--althea-brand)]"><RotateCcw size={10} /> Replay</button>
                      )}
                      {['pending', 'scheduled', 'failed'].includes(execution.status) && !execution.dead_lettered_at && (
                        <button type="button" onClick={() => void cancelExecution(execution)} className="grid h-8 w-8 place-items-center rounded-lg border border-red-400/10 text-red-300" aria-label="Cancelar execução"><X size={11} /></button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-[#5f6e66]">
                    <span>Tentativas {execution.attempt_count}/{execution.max_attempts}</span>
                    <span>Auditadas: {execution.attempts}</span>
                    {execution.next_retry_at && <span>Retry: {dateTime(execution.next_retry_at)}</span>}
                    {execution.replay_count > 0 && <span>Replays: {execution.replay_count}</span>}
                  </div>
                  {execution.error_message && (
                    <p className="mt-2 rounded-lg border border-red-400/10 bg-red-400/[.03] px-2.5 py-2 text-[8px] leading-4 text-red-300">{execution.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {editorOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[160] flex justify-end bg-black/70 backdrop-blur-sm" onClick={event => { if (event.currentTarget === event.target && !saving) setEditorOpen(false) }}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/[.07] bg-[#090d0b] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[var(--althea-brand)]">Automation Builder</p>
                <h2 className="mt-1 text-xl font-semibold text-white">{editingRuleId ? 'Editar automação' : 'Nova automação'}</h2>
                <p className="mt-1 text-[10px] leading-5 text-[var(--althea-muted)]">Defina evento, filtro e ações. A ativação não simula sucesso; as execuções reais aparecem no histórico.</p>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)} disabled={saving} className="rounded-lg p-2 text-[var(--althea-muted)] hover:bg-white/5 hover:text-white disabled:opacity-40"><X size={18} /></button>
            </div>

            <div className="mt-6 space-y-4">
              <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
                <SectionTitle number="01" title="Identidade e status" />
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_170px]">
                  <label className="grid gap-1.5 text-[9px] text-[var(--althea-muted)]">Nome
                    <input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Ex.: Recuperar checkout abandonado" className="althea-ds-input text-sm" />
                  </label>
                  <label className="grid gap-1.5 text-[9px] text-[var(--althea-muted)]">Status
                    <select value={ruleStatus} onChange={event => setRuleStatus(event.target.value as typeof ruleStatus)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-xs text-white outline-none">
                      <option value="draft">Rascunho</option><option value="active">Ativa</option><option value="paused">Pausada</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
                <SectionTitle number="02" title="Disparo" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-[9px] text-[var(--althea-muted)]">Evento canônico
                    <select value={eventType} onChange={event => setEventType(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-xs text-white outline-none">
                      <option value="*">Qualquer evento</option>
                      {(payload?.event_types ?? []).map(item => <option key={item.event_type} value={item.event_type}>{item.event_type}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[9px] text-[var(--althea-muted)]">Funil
                    <select value={funnelId} onChange={event => setFunnelId(event.target.value)} className="h-10 rounded-xl border border-white/[.055] bg-[var(--althea-bg)] px-3 text-xs text-white outline-none">
                      <option value="*">Todos os funis</option>
                      {(payload?.funnels ?? []).map(funnel => <option key={funnel.id} value={funnel.id}>{funnel.name}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div><b className="text-[10px] text-zinc-200">Condições opcionais</b><p className="mt-1 text-[8px] text-[var(--althea-muted)]">Campos podem apontar para o payload, como customer.email, amount ou status.</p></div>
                  <div className="flex items-center gap-2">
                    <select value={logical} onChange={event => setLogical(event.target.value as 'and' | 'or')} className="h-8 rounded-lg border border-white/[.05] bg-[var(--althea-bg)] px-2 text-[8px] text-zinc-300"><option value="and">TODAS</option><option value="or">QUALQUER</option></select>
                    <button type="button" disabled={conditions.length >= 20} onClick={() => setConditions(current => [...current, newCondition()])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[.055] px-2 text-[8px] text-zinc-300 disabled:opacity-40"><Plus size={10} /> Condição</button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {conditions.map((condition, index) => (
                    <div key={condition.id} className="grid gap-2 rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3 sm:grid-cols-[1fr_170px_1fr_32px]">
                      <input value={condition.field} onChange={event => setConditions(current => current.map((item, i) => i === index ? { ...item, field: event.target.value } : item))} placeholder="payload.campo" className="h-9 rounded-lg border border-white/[.045] bg-black/20 px-3 text-[9px] font-mono text-white outline-none" />
                      <select value={condition.operator} onChange={event => setConditions(current => current.map((item, i) => i === index ? { ...item, operator: event.target.value } : item))} className="h-9 rounded-lg border border-white/[.045] bg-black/20 px-2 text-[9px] text-white outline-none">
                        {CONDITION_OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <input disabled={['is_null', 'is_not_null'].includes(condition.operator)} value={condition.value} onChange={event => setConditions(current => current.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} placeholder={condition.operator === 'exists' ? 'true / false' : 'valor'} className="h-9 rounded-lg border border-white/[.045] bg-black/20 px-3 text-[9px] text-white outline-none disabled:opacity-35" />
                      <button type="button" onClick={() => setConditions(current => current.filter((_, i) => i !== index))} className="grid h-9 w-8 place-items-center rounded-lg text-red-300/70 hover:bg-red-400/[.05]"><X size={12} /></button>
                    </div>
                  ))}
                  {conditions.length === 0 && <p className="rounded-xl border border-dashed border-white/[.05] p-3 text-center text-[8px] text-[#5f6e66]">Sem condições adicionais: o evento + funil definem o disparo.</p>}
                </div>
              </section>

              <section className="rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
                <SectionTitle number="03" title="Ações" />
                <div className="mt-4 space-y-2">
                  {actions.map((action, index) => (
                    <div key={action.id} className="rounded-xl border border-white/[.045] bg-[var(--althea-bg)] p-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[rgba(29,184,84,.07)] text-[8px] font-bold text-[var(--althea-brand)]">{index + 1}</span>
                        <select value={action.type} onChange={event => setActions(current => current.map((item, i) => i === index ? { ...item, type: event.target.value as ActionDraft['type'] } : item))} className="h-9 min-w-0 flex-1 rounded-lg border border-white/[.045] bg-black/20 px-3 text-[9px] text-white outline-none">
                          {(Object.keys(ACTION_LABELS) as ActionDraft['type'][]).map(type => <option key={type} value={type}>{ACTION_LABELS[type]}</option>)}
                        </select>
                        {actions.length > 1 && <button type="button" onClick={() => setActions(current => current.filter((_, i) => i !== index))} className="grid h-9 w-9 place-items-center rounded-lg text-red-300/70"><Trash2 size={11} /></button>}
                      </div>

                      {action.type === 'send_crm_message' && (
                        <label className="mt-3 grid gap-1.5 text-[8px] text-[var(--althea-muted)]">Mensagem no chat do funil
                          <textarea value={action.body} onChange={event => setActions(current => current.map((item, i) => i === index ? { ...item, body: event.target.value } : item))} maxLength={4000} rows={3} placeholder="Mensagem enviada quando a conversa estiver presente no contexto do evento." className="rounded-lg border border-white/[.045] bg-black/20 p-3 text-[10px] text-white outline-none" />
                        </label>
                      )}

                      {action.type === 'set_conversation_status' && (
                        <label className="mt-3 grid gap-1.5 text-[8px] text-[var(--althea-muted)]">Novo status da conversa
                          <select value={action.conversationStatus} onChange={event => setActions(current => current.map((item, i) => i === index ? { ...item, conversationStatus: event.target.value as ActionDraft['conversationStatus'] } : item))} className="h-9 rounded-lg border border-white/[.045] bg-black/20 px-3 text-[9px] text-white outline-none">
                            <option value="open">Aberta</option><option value="pending">Pendente</option><option value="closed">Fechada</option>
                          </select>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" disabled={actions.length >= 5} onClick={() => setActions(current => [...current, newAction()])} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[.055] px-3 text-[8px] text-zinc-300 disabled:opacity-40"><Plus size={11} /> Adicionar ação</button>

                <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgba(212,175,55,.12)] bg-[rgba(212,175,55,.035)] p-3 text-[8px] leading-4 text-[#D4AF37]">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Ações financeiras diretas não fazem parte deste builder. Mudanças de pagamento, gateway, conciliação e estorno continuam nos respectivos motores de autoridade.
                </div>
              </section>

              <button type="button" onClick={() => void saveRule()} disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[10px] font-bold text-[#06110a] disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Salvando...' : editingRuleId ? 'Salvar alterações' : 'Criar automação'}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function funnelName(funnels: Funnel[], id: string): string {
  if (!id || id === '*') return 'Todos'
  return funnels.find(item => item.id === id)?.name || id
}

function Badge({ value }: { value: string | null | undefined }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[7px] font-semibold uppercase tracking-wider ${statusClass(value)}`}>{statusLabel(value)}</span>
}

function Metric({ icon: Icon, label, value, suffix = '', note, warning = false }: {
  icon: typeof Activity
  label: string
  value: number
  suffix?: string
  note: string
  warning?: boolean
}) {
  return (
    <article className="min-h-[108px] rounded-2xl border border-white/[.055] bg-[var(--althea-surface)] p-4">
      <div className="flex items-center justify-between gap-3"><span className="text-[9px] text-[var(--althea-muted)]">{label}</span><Icon size={14} className={warning ? 'text-[#D4AF37]' : 'text-[var(--althea-brand)]'} /></div>
      <strong className={`mt-4 block text-[22px] font-semibold ${warning ? 'text-[#D4AF37]' : 'text-white'}`}>{value}{suffix}</strong>
      <span className="mt-1 block text-[8px] text-[var(--althea-muted)]">{note}</span>
    </article>
  )
}

function Mini({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className="rounded-lg border border-white/[.04] bg-black/10 px-2.5 py-2"><span className="block text-[7px] text-[#5f6e66]">{label}</span><b className={`mt-1 block text-[9px] ${warning ? 'text-[#D4AF37]' : 'text-zinc-300'}`}>{value}</b></div>
}

function Skeleton() {
  return <div className="mt-4 space-y-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--althea-bg)]" />)}</div>
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-4 grid min-h-[290px] place-items-center rounded-xl border border-dashed border-white/[.055] bg-[var(--althea-bg)] p-6 text-center">
      <div className="max-w-sm">
        <Workflow size={24} className="mx-auto text-[var(--althea-brand)]" />
        <h3 className="mt-3 text-xs font-semibold text-white">Nenhuma automação configurada</h3>
        <p className="mt-2 text-[9px] leading-5 text-[var(--althea-muted)]">Crie a primeira regra usando eventos canônicos. A plataforma só registra execução quando um evento real corresponder ao gatilho.</p>
        <button type="button" onClick={onCreate} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--althea-brand)] px-4 text-[9px] font-bold text-[#06110a]"><Plus size={12} /> Criar automação</button>
      </div>
    </div>
  )
}

function SectionTitle({ number, title }: { number: string; title: string }) {
  return <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full border border-[rgba(29,184,84,.12)] bg-[rgba(29,184,84,.045)] text-[8px] font-bold text-[var(--althea-brand)]">{number}</span><h3 className="text-[10px] font-semibold text-zinc-200">{title}</h3></div>
}
