import type { SupabaseClient } from '@supabase/supabase-js'

export interface EvaluationToolCall {
  toolKey: string
  requestedInput: Record<string, unknown>
  observedOutput?: unknown
  schemaValid: boolean
  authorized: boolean
  resultValid: boolean
}

export interface EvaluationAssertion {
  type: string
  passed: boolean
  score: number
  evidence: Array<Record<string, unknown>>
}

export interface ContinuousEvaluationInput {
  tenantId: string
  executionId?: string
  answer: string
  evidence: Array<{ source: string; value: unknown }>
  toolCalls: EvaluationToolCall[]
  expectedClaims?: Array<{ claim: string; supported: boolean }>
  causalConclusion?: { confidence: number; evidenceCount: number }
  dataConfidence?: number
  latencyMs?: number
  totalCostMinor?: number
}

export interface ContinuousEvaluationResult {
  evaluationId: string
  overallScore: number
  hallucinationRisk: number
  groundingScore: number
  toolCallAccuracy: number
  evidenceCoverage: number
  causalConfidence: number
  dataConfidence: number
  decision: 'PASS' | 'REVIEW' | 'BLOCK'
  assertions: EvaluationAssertion[]
  summary: string
}

const VERSION = '1.0.0'

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function scoreClaims(claims: ContinuousEvaluationInput['expectedClaims']): { grounding: number; hallucination: number; coverage: number } {
  if (!claims || claims.length === 0) return { grounding: 0, hallucination: 0, coverage: 0 }
  const supported = claims.filter((claim) => claim.supported).length
  const grounding = supported / claims.length
  return { grounding, hallucination: 1 - grounding, coverage: grounding }
}

export function evaluateDeterministically(input: ContinuousEvaluationInput): Omit<ContinuousEvaluationResult, 'evaluationId'> {
  const claimScores = scoreClaims(input.expectedClaims)
  const toolCalls = input.toolCalls
  const toolAccuracy = toolCalls.length === 0
    ? 1
    : toolCalls.filter((call) => call.schemaValid && call.authorized && call.resultValid).length / toolCalls.length
  const causalConfidence = input.causalConclusion
    ? clamp(input.causalConclusion.confidence * Math.min(1, input.causalConclusion.evidenceCount / 3))
    : 0
  const dataConfidence = clamp(input.dataConfidence ?? (input.evidence.length > 0 ? Math.min(1, input.evidence.length / 3) : 0))

  const overallScore = clamp(
    claimScores.grounding * 0.25 +
    toolAccuracy * 0.25 +
    claimScores.coverage * 0.15 +
    dataConfidence * 0.20 +
    causalConfidence * 0.15,
  )
  const hallucinationRisk = clamp(claimScores.hallucination + (1 - toolAccuracy) * 0.25)
  const decision = hallucinationRisk >= 0.5 || toolAccuracy < 0.5
    ? 'BLOCK'
    : overallScore >= 0.8 && hallucinationRisk <= 0.1
      ? 'PASS'
      : 'REVIEW'

  const assertions: EvaluationAssertion[] = [
    { type: 'GROUNDING', passed: claimScores.grounding >= 0.8, score: claimScores.grounding, evidence: input.evidence.map((item) => ({ source: item.source })) },
    { type: 'TOOL_CALL_ACCURACY', passed: toolAccuracy === 1, score: toolAccuracy, evidence: toolCalls.map((call) => ({ toolKey: call.toolKey, schemaValid: call.schemaValid, authorized: call.authorized, resultValid: call.resultValid })) },
    { type: 'DATA_CONFIDENCE', passed: dataConfidence >= 0.8, score: dataConfidence, evidence: [{ evidenceCount: input.evidence.length }] },
    { type: 'CAUSAL_CONFIDENCE', passed: causalConfidence >= 0.8, score: causalConfidence, evidence: input.causalConclusion ? [{ evidenceCount: input.causalConclusion.evidenceCount }] : [] },
  ]

  return {
    overallScore,
    hallucinationRisk,
    groundingScore: claimScores.grounding,
    toolCallAccuracy: toolAccuracy,
    evidenceCoverage: claimScores.coverage,
    causalConfidence,
    dataConfidence,
    decision,
    assertions,
    summary: decision === 'PASS'
      ? 'Execução sustentada por evidência e contratos válidos.'
      : decision === 'REVIEW'
        ? 'Execução requer revisão porque a evidência ou confiança é insuficiente.'
        : 'Execução bloqueada por risco de alucinação, autorização ou resultado inválido.',
  }
}

export class IaraContinuousEvaluator {
  constructor(private readonly supabase: SupabaseClient) {}

  async evaluate(input: ContinuousEvaluationInput): Promise<ContinuousEvaluationResult> {
    if (!input.tenantId || !input.answer.trim()) throw new Error('Contexto de avaliação inválido.')
    const result = evaluateDeterministically(input)

    const { data, error } = await this.supabase.from('iara_evaluations').insert({
      tenant_id: input.tenantId,
      execution_id: input.executionId ?? null,
      evaluator_version: VERSION,
      overall_score: result.overallScore,
      hallucination_risk: result.hallucinationRisk,
      grounding_score: result.groundingScore,
      tool_call_accuracy: result.toolCallAccuracy,
      evidence_coverage: result.evidenceCoverage,
      causal_confidence: result.causalConfidence,
      data_confidence: result.dataConfidence,
      total_cost_minor: input.totalCostMinor ?? null,
      latency_ms: input.latencyMs ?? null,
      decision: result.decision,
      summary: result.summary,
    }).select('evaluation_id').single()
    if (error) throw new Error(`Falha ao persistir avaliação: ${error.message}`)

    const evaluationId = data.evaluation_id as string
    if (result.assertions.length > 0) {
      const { error: assertionError } = await this.supabase.from('iara_evaluation_assertions').insert(
        result.assertions.map((assertion) => ({
          evaluation_id: evaluationId,
          assertion_type: assertion.type,
          passed: assertion.passed,
          score: assertion.score,
          evidence: assertion.evidence,
        })),
      )
      if (assertionError) throw new Error(`Falha ao persistir assertions: ${assertionError.message}`)
    }

    if (input.toolCalls.length > 0) {
      const { error: toolError } = await this.supabase.from('iara_evaluation_tool_calls').insert(
        input.toolCalls.map((call) => ({
          evaluation_id: evaluationId,
          tool_key: call.toolKey,
          requested_input: call.requestedInput,
          observed_output: call.observedOutput ?? null,
          schema_valid: call.schemaValid,
          authorized: call.authorized,
          result_valid: call.resultValid,
        })),
      )
      if (toolError) throw new Error(`Falha ao persistir tool calls: ${toolError.message}`)
    }

    return { evaluationId, ...result }
  }
}
