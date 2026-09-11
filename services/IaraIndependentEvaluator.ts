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

export class IaraIndependentEvaluator {
  constructor(private readonly supabase: SupabaseClient) {}

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

    const result = asRecord(data)
    const evaluationId = typeof result?.evaluation_id === 'string' ? result.evaluation_id : null
    const decision = typeof result?.decision === 'string' ? result.decision : input.decision
    if (!evaluationId) throw new IaraEvaluatorError('EVALUATION_RESULT_INVALID')

    return { evaluationId, decision }
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
  const scores = [input.overallScore, input.hallucinationRisk, input.groundingScore, input.toolCallAccuracy, input.evidenceCoverage, input.causalConfidence, input.dataConfidence]
  if (scores.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new IaraEvaluatorError('EVALUATION_SCORE_INVALID')
  if (!Number.isInteger(input.totalCostMinor) || input.totalCostMinor < 0) throw new IaraEvaluatorError('EVALUATION_COST_INVALID')
  if (!Number.isInteger(input.latencyMs) || input.latencyMs < 0) throw new IaraEvaluatorError('EVALUATION_LATENCY_INVALID')
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}
