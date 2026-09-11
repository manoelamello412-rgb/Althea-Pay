import type { SupabaseClient } from '@supabase/supabase-js'

export interface IaraEvaluationInput {
  readonly tenantId: string
  readonly executionId: string
  readonly evaluatorVersion: string
  readonly overallScore: number
  readonly hallucinationRisk: number
  readonly groundingScore: number
  readonly toolCallAccuracy: number
  readonly evidenceCoverage: number
  readonly causalConfidence: number
  readonly dataConfidence: number
  readonly totalCostMinor: number
  readonly latencyMs: number
  readonly decision: string
  readonly summary: string
  readonly assertions: readonly Record<string, unknown>[]
  readonly claims: readonly Record<string, unknown>[]
  readonly failures: readonly Record<string, unknown>[]
  readonly toolCalls: readonly Record<string, unknown>[]
}

export interface IaraEvaluationResult {
  readonly evaluationId: string
  readonly decision: string
}

export interface IaraExecutionEvidenceAssessment {
  readonly executionId: string
  readonly tenantId: string
  readonly actionId: string
  readonly actionStatus: string
  readonly executedAt: string
  readonly metrics: {
    readonly latencyMs: number | null
    readonly totalCostMinor: number | null
    readonly overallScore: number | null
    readonly hallucinationRisk: number | null
    readonly groundingScore: number | null
    readonly toolCallAccuracy: number | null
    readonly evidenceCoverage: number | null
    readonly causalConfidence: number | null
    readonly dataConfidence: number | null
  }
  readonly calculability: {
    readonly latencyMs: boolean
    readonly totalCostMinor: boolean
    readonly overallScore: boolean
    readonly hallucinationRisk: boolean
    readonly groundingScore: boolean
    readonly toolCallAccuracy: boolean
    readonly evidenceCoverage: boolean
    readonly causalConfidence: boolean
    readonly dataConfidence: boolean
  }
  readonly persistable: boolean
  readonly blockers: readonly string[]
}

interface ExecutionActionRow {
  readonly id: string
  readonly user_id: string
  readonly status: string
  readonly created_at: string
  readonly executed_at: string | null
  readonly execution_id: string | null
}

export class IaraIndependentEvaluator {
  constructor(private readonly supabase: SupabaseClient) {}

  async assessExecution(tenantId: string, executionId: string): Promise<IaraExecutionEvidenceAssessment> {
    if (!isUuid(tenantId) || !isUuid(executionId)) {
      throw new IaraEvaluatorError('EVALUATION_IDENTITY_INVALID')
    }

    const { data: action, error } = await this.supabase
      .from('crm_ai_actions')
      .select('id,user_id,status,created_at,executed_at,execution_id')
      .eq('execution_id', executionId)
      .eq('user_id', tenantId)
      .maybeSingle<ExecutionActionRow>()

    if (error) throw new IaraEvaluatorError('EXECUTION_EVIDENCE_LOAD_FAILED', error.message)
    if (!action) throw new IaraEvaluatorError('EXECUTION_NOT_FOUND')
    if (action.execution_id !== executionId) throw new IaraEvaluatorError('EXECUTION_IDENTITY_MISMATCH')
    if (action.user_id !== tenantId) throw new IaraEvaluatorError('EVALUATION_TENANT_MISMATCH')
    if (action.status !== 'executed' || !action.executed_at) throw new IaraEvaluatorError('EXECUTION_NOT_COMPLETED')

    const latencyMs = deterministicLatency(action.created_at, action.executed_at)
    const blockers: string[] = []

    if (latencyMs === null) blockers.push('LATENCY_EVIDENCE_UNAVAILABLE')
    blockers.push(
      'OVERALL_SCORE_EVIDENCE_UNAVAILABLE',
      'HALLUCINATION_RISK_EVIDENCE_UNAVAILABLE',
      'GROUNDING_SCORE_EVIDENCE_UNAVAILABLE',
      'TOOL_CALL_ACCURACY_EVIDENCE_UNAVAILABLE',
      'EVIDENCE_COVERAGE_EVIDENCE_UNAVAILABLE',
      'CAUSAL_CONFIDENCE_EVIDENCE_UNAVAILABLE',
      'DATA_CONFIDENCE_EVIDENCE_UNAVAILABLE',
      'TOTAL_COST_EVIDENCE_UNAVAILABLE',
    )

    return {
      executionId,
      tenantId,
      actionId: action.id,
      actionStatus: action.status,
      executedAt: action.executed_at,
      metrics: {
        latencyMs,
        totalCostMinor: null,
        overallScore: null,
        hallucinationRisk: null,
        groundingScore: null,
        toolCallAccuracy: null,
        evidenceCoverage: null,
        causalConfidence: null,
        dataConfidence: null,
      },
      calculability: {
        latencyMs: latencyMs !== null,
        totalCostMinor: false,
        overallScore: false,
        hallucinationRisk: false,
        groundingScore: false,
        toolCallAccuracy: false,
        evidenceCoverage: false,
        causalConfidence: false,
        dataConfidence: false,
      },
      persistable: blockers.length === 0,
      blockers,
    }
  }

  async persist(input: IaraEvaluationInput): Promise<IaraEvaluationResult> {
    validateInput(input)

    const { data, error } = await this.supabase.rpc('persist_iara_independent_evaluation', {
      p_tenant_id: input.tenantId,
      p_execution_id: input.executionId,
      p_evaluator_version: input.evaluatorVersion,
      p_overall_score: input.overallScore,
      p_hallucination_risk: input.hallucinationRisk,
      p_grounding_score: input.groundingScore,
      p_tool_call_accuracy: input.toolCallAccuracy,
      p_evidence_coverage: input.evidenceCoverage,
      p_causal_confidence: input.causalConfidence,
      p_data_confidence: input.dataConfidence,
      p_total_cost_minor: input.totalCostMinor,
      p_latency_ms: input.latencyMs,
      p_decision: input.decision,
      p_summary: input.summary,
      p_assertions: input.assertions,
      p_claims: input.claims,
      p_failures: input.failures,
      p_tool_calls: input.toolCalls,
    })

    if (error) throw new IaraEvaluatorError('EVALUATION_PERSISTENCE_FAILED', error.message)

    const evaluationId = typeof data === 'string' ? data : null
    if (!evaluationId || !isUuid(evaluationId)) throw new IaraEvaluatorError('EVALUATION_RESULT_INVALID')

    return { evaluationId, decision: input.decision }
  }
}

export class IaraEvaluatorError extends Error {
  constructor(readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'IaraEvaluatorError'
  }
}

function validateInput(input: IaraEvaluationInput): void {
  if (!isUuid(input.tenantId) || !isUuid(input.executionId)) throw new IaraEvaluatorError('EVALUATION_IDENTITY_INVALID')
  if (!input.evaluatorVersion.trim() || !input.summary.trim()) throw new IaraEvaluatorError('EVALUATION_METADATA_INVALID')
  if (!['PASS', 'REVIEW', 'BLOCK'].includes(input.decision)) throw new IaraEvaluatorError('EVALUATION_DECISION_INVALID')
  const scores = [input.overallScore, input.hallucinationRisk, input.groundingScore, input.toolCallAccuracy, input.evidenceCoverage, input.causalConfidence, input.dataConfidence]
  if (scores.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new IaraEvaluatorError('EVALUATION_SCORE_INVALID')
  if (!Number.isInteger(input.totalCostMinor) || input.totalCostMinor < 0) throw new IaraEvaluatorError('EVALUATION_COST_INVALID')
  if (!Number.isInteger(input.latencyMs) || input.latencyMs < 0) throw new IaraEvaluatorError('EVALUATION_LATENCY_INVALID')
}

function deterministicLatency(createdAt: string, executedAt: string): number | null {
  const start = Date.parse(createdAt)
  const end = Date.parse(executedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return end - start
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
