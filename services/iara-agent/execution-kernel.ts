import type { SupabaseClient } from '@supabase/supabase-js'
import { getIaraToolDefinition } from './tool-registry'

const FORBIDDEN_DRAFT_PATTERNS = [
  /\bguaranteed?\b/i,
  /\bsem\s+risco\b/i,
  /\bgarantimos?\b/i,
  /\bdesconto\b/i,
  /\bdiscount\b/i,
  /\bstatus\s+do\s+pagamento\b/i,
]

interface AiActionRow {
  id: string
  conversation_id: string
  action_type: string
  payload: Record<string, unknown> | null
  status: string
}

export interface IaraExecutionResult {
  readonly ok: boolean
  readonly action_id: string
  readonly execution_id: string
  readonly status: string
  readonly executed_at?: string
  readonly message?: Record<string, unknown>
}

export class IaraExecutionKernel {
  constructor(private readonly supabase: SupabaseClient) {}

  async execute(actionId: string, userId: string): Promise<IaraExecutionResult> {
    const { data: action, error: loadError } = await this.supabase
      .from('crm_ai_actions')
      .select('id,conversation_id,action_type,payload,status')
      .eq('id', actionId)
      .eq('user_id', userId)
      .maybeSingle<AiActionRow>()

    if (loadError || !action) throw new IaraKernelError('AI_ACTION_NOT_FOUND', 404)

    const tool = getIaraToolDefinition(action.action_type)
    if (!tool) throw new IaraKernelError('ACTION_NOT_REGISTERED', 422)
    if (tool.authorization !== 'authenticated_owner') throw new IaraKernelError('AUTHORIZATION_POLICY_INVALID', 403)
    if (action.status !== 'accepted') throw new IaraKernelError('HUMAN_APPROVAL_REQUIRED', 409)

    const payload = action.payload ?? {}
    const draft = typeof payload.ai_draft === 'string' ? payload.ai_draft.trim() : ''
    if (!draft || draft.length > 4000 || FORBIDDEN_DRAFT_PATTERNS.some((pattern) => pattern.test(draft))) {
      throw new IaraKernelError('AI_DRAFT_REJECTED', 422)
    }

    const { data, error } = await this.supabase.rpc(tool.executor, {
      p_action_id: action.id,
      p_body: draft,
    })

    if (error) throw new IaraKernelError('AI_ACTION_EXECUTION_FAILED', 409, error.message)
    if (
      !isExecutionRecord(data)
      || data.ok !== true
      || data.action_id !== action.id
      || data.status !== 'executed'
      || typeof data.execution_id !== 'string'
      || !isUuid(data.execution_id)
    ) {
      throw new IaraKernelError('INVALID_EXECUTION_RESULT', 502)
    }

    return {
      ok: true,
      action_id: action.id,
      execution_id: data.execution_id,
      status: 'executed',
      executed_at: typeof data.executed_at === 'string' ? data.executed_at : undefined,
      message: isRecord(data.message) ? data.message : undefined,
    }
  }
}

export class IaraKernelError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'IaraKernelError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExecutionRecord(value: unknown): value is {
  ok: boolean
  action_id: string
  execution_id: string
  status: string
  executed_at?: unknown
  message?: unknown
} {
  return isRecord(value)
    && typeof value.ok === 'boolean'
    && typeof value.action_id === 'string'
    && typeof value.execution_id === 'string'
    && typeof value.status === 'string'
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
