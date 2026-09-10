import type { SupabaseClient } from '@supabase/supabase-js'

export enum GateContext {
  READ = 'READ',
  OPERATIONAL = 'OPERATIONAL',
  FINANCIAL = 'FINANCIAL',
}

export enum EvaluationVerdict {
  PASS = 'PASS',
  REVIEW = 'REVIEW',
  BLOCK = 'BLOCK',
}

type ClaimType = 'FACT' | 'NUMERIC' | 'TEMPORAL' | 'CAUSAL' | 'INFERENCE' | 'RECOMMENDATION'
type FailureSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface GeneratedIaraOutput {
  tenantId: string
  responseText: string
  invokedTool: string | null
  toolPayloadStr: string | null
  latencyMs: number
  toolCalls?: Array<{
    toolKey: string
    requestedInput: Record<string, unknown>
    observedOutput?: unknown
    schemaValid: boolean
    authorized: boolean
    resultValid: boolean
  }>
  totalCostMinor?: number
  executionId?: string
}

export interface EvaluationClaim {
  claim: string
  claimType: ClaimType
  verified: boolean
  score: number
  evidence: Array<Record<string, unknown>>
  freshnessSeconds?: number
}

export interface EvaluationFailure {
  failureCode: string
  severity: FailureSeverity
  message: string
  evidence: Array<Record<string, unknown>>
}

export interface DimensionScores {
  groundingFactCheck: number
  tenantIsolationSecurity: number
  mathematicalAccuracy: number
  causalityValidation: number
  absenceOfContradictions: number
}

export interface AuditEvaluationReport {
  evaluationId: string
  verdict: EvaluationVerdict
  gateEnforced: GateContext
  scores: DimensionScores
  detectedAnomalies: string[]
  claims: EvaluationClaim[]
  failures: EvaluationFailure[]
  executionCostUsd: number | null
  timestamp: string
}

interface TransactionRecord {
  id: string
  user_id: string
  product_id: string | null
  amount: number
  currency: string | null
  status: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface ProductRecord {
  id: string
  user_id: string
  data: Record<string, unknown>
  created_at: string
}

interface VerifiedEntity {
  kind: 'transaction' | 'product'
  id: string
  tenantVerified: boolean
  record: TransactionRecord | ProductRecord
  freshnessSeconds: number
}

const VERSION = '2.0.0'
const LIVE_FRESHNESS_SECONDS = 300
const MONEY_REGEX = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/g
const TX_REGEX = /\btx_[A-Za-z0-9_-]+\b/g
const PRODUCT_REGEX = /\bprod_[A-Za-z0-9_-]+\b/g
const PERCENT_REGEX = /\b([0-9]+(?:[.,][0-9]+)?)\s*%/g
const SENTENCE_REGEX = /[^.!?]+[.!?]+|[^.!?]+$/g

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function parseMoney(raw: string): number {
  const normalized = raw.replace(/R\$\s*/i, '').trim()
  const comma = normalized.lastIndexOf(',')
  const dot = normalized.lastIndexOf('.')
  if (comma > dot) return Number(normalized.replace(/\./g, '').replace(',', '.'))
  if (dot >= 0 && normalized.split('.')[1]?.length === 3) return Number(normalized.replace(/\./g, ''))
  return Number(normalized.replace(',', '.'))
}

function extractMoney(text: string): number[] {
  return [...text.matchAll(MONEY_REGEX)].map((match) => parseMoney(match[0])).filter(Number.isFinite)
}

function extractPercentages(text: string): number[] {
  return [...text.matchAll(PERCENT_REGEX)].map((match) => Number(match[1].replace(',', '.'))).filter(Number.isFinite)
}

function classifyClaim(sentence: string): ClaimType {
  const lower = sentence.toLowerCase()
  if (/(porque|causou|causa|devido a|resultou em|responsável por)/.test(lower)) return 'CAUSAL'
  if (/(recomendo|recomenda-se|sugiro|deve-se|faça|execute|ative|desative)/.test(lower)) return 'RECOMMENDATION'
  if (/(\d+\s*%|r\$\s*[\d.,]+|tx_|prod_)/i.test(sentence)) return 'NUMERIC'
  if (/(hoje|agora|atual|neste momento|últim[oa]s?|ontem|amanhã)/.test(lower)) return 'TEMPORAL'
  if (/(pode|provavelmente|parece|indica|sugere)/.test(lower)) return 'INFERENCE'
  return 'FACT'
}

function extractClaims(text: string): EvaluationClaim[] {
  return SENTENCE_REGEX.exec(text) ? [...text.matchAll(SENTENCE_REGEX)].map((match) => ({
    claim: match[0].trim(),
    claimType: classifyClaim(match[0].trim()),
    verified: false,
    score: 0,
    evidence: [],
  })).filter((claim) => claim.claim.length > 0) : []
}

function isLiveClaim(claim: string): boolean {
  return /(agora|atual|atualmente|neste momento|hoje|em tempo real|status atual|saldo atual)/i.test(claim)
}

function isContradictoryText(text: string): boolean {
  const lower = text.toLowerCase()
  const directionalPairs: Array<[RegExp, RegExp]> = [
    [/\baumentou\b/, /\bcaiu\b/],
    [/\bsubiu\b/, /\bdesceu\b/],
    [/\bmelhorou\b/, /\bpiorou\b/],
    [/\bcresceu\b/, /\bdiminuiu\b/],
  ]
  return directionalPairs.some(([a, b]) => a.test(lower) && b.test(lower)) && !/compar|versus|vs\.|enquanto|por outro lado/i.test(lower)
}

function hasUnqualifiedCausalLanguage(claim: string): boolean {
  return /\b(porque|causou|causa|resultou em|responsável por)\b/i.test(claim) && !/evidência|telemetria|experimento|teste|controle|causalidade/i.test(claim)
}

function failure(code: string, severity: FailureSeverity, message: string, evidence: Array<Record<string, unknown>> = []): EvaluationFailure {
  return { failureCode: code, severity, message, evidence }
}

function minScore(values: number[]): number {
  return values.length === 0 ? 1 : clamp(Math.min(...values))
}

export class IaraIndependentEvaluator {
  constructor(private readonly supabase: SupabaseClient) {}

  private async userBelongsToTenant(userId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('organization_id', tenantId)
      .limit(1)
    if (error) throw new Error(`Falha ao verificar isolamento de tenant: ${error.message}`)
    return (data?.length ?? 0) > 0
  }

  private async verifyTransaction(id: string, tenantId: string): Promise<VerifiedEntity | null> {
    const { data, error } = await this.supabase
      .from('gateway_transactions')
      .select('id,user_id,product_id,amount,currency,status,created_at,updated_at,completed_at')
      .or(`id.eq.${id},external_id.eq.${id}`)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Falha ao verificar transação ${id}: ${error.message}`)
    if (!data) return null
    const record = data as TransactionRecord
    const tenantVerified = await this.userBelongsToTenant(record.user_id, tenantId)
    const freshnessSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(record.updated_at)) / 1000))
    return { kind: 'transaction', id, tenantVerified, record, freshnessSeconds }
  }

  private async verifyProduct(id: string, tenantId: string): Promise<VerifiedEntity | null> {
    const { data, error } = await this.supabase
      .from('products')
      .select('id,user_id,data,created_at')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`Falha ao verificar produto ${id}: ${error.message}`)
    if (!data) return null
    const record = data as ProductRecord
    const tenantVerified = await this.userBelongsToTenant(record.user_id, tenantId)
    const freshnessSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(record.created_at)) / 1000))
    return { kind: 'product', id, tenantVerified, record, freshnessSeconds }
  }

  private async verifyEntities(text: string, tenantId: string, claims: EvaluationClaim[], failures: EvaluationFailure[]): Promise<VerifiedEntity[]> {
    const entities: VerifiedEntity[] = []
    for (const id of unique(text.match(TX_REGEX) ?? [])) {
      const entity = await this.verifyTransaction(id, tenantId)
      if (!entity) {
        failures.push(failure('ENTITY_NOT_FOUND', 'HIGH', `Transação ${id} citada na resposta não foi encontrada na fonte autoritativa.`))
        continue
      }
      entities.push(entity)
      if (!entity.tenantVerified) {
        failures.push(failure('TENANT_ISOLATION_VIOLATION', 'CRITICAL', `A transação ${id} não pertence ao tenant avaliado.`))
      }
      for (const claim of claims.filter((item) => item.claim.includes(id))) {
        claim.evidence.push({ source: 'gateway_transactions', entityId: entity.id, tenantVerified: entity.tenantVerified })
        claim.freshnessSeconds = entity.freshnessSeconds
        claim.verified = entity.tenantVerified
        claim.score = entity.tenantVerified ? 1 : 0
      }
    }
    for (const id of unique(text.match(PRODUCT_REGEX) ?? [])) {
      const entity = await this.verifyProduct(id, tenantId)
      if (!entity) {
        failures.push(failure('ENTITY_NOT_FOUND', 'HIGH', `Produto ${id} citado na resposta não foi encontrado na fonte autoritativa.`))
        continue
      }
      entities.push(entity)
      if (!entity.tenantVerified) failures.push(failure('TENANT_ISOLATION_VIOLATION', 'CRITICAL', `Produto ${id} não pertence ao tenant avaliado.`))
      for (const claim of claims.filter((item) => item.claim.includes(id))) {
        claim.evidence.push({ source: 'products', entityId: entity.id, tenantVerified: entity.tenantVerified })
        claim.freshnessSeconds = entity.freshnessSeconds
        claim.verified = entity.tenantVerified
        claim.score = entity.tenantVerified ? 1 : 0
      }
    }
    return entities
  }

  private verifyNumbers(text: string, entities: VerifiedEntity[], claims: EvaluationClaim[], failures: EvaluationFailure[]): number {
    const money = extractMoney(text)
    const transactions = entities.filter((entity): entity is VerifiedEntity & { record: TransactionRecord } => entity.kind === 'transaction')
    if (money.length === 0) return 1
    if (transactions.length === 0) {
      failures.push(failure('UNVERIFIED_FINANCIAL_CLAIM', 'HIGH', 'A resposta contém valor financeiro sem uma entidade financeira verificável associada.'))
      return 0
    }
    const expectedAmounts = transactions.map((entity) => entity.record.amount)
    const allMatch = money.every((value) => expectedAmounts.some((expected) => Math.abs(value - expected) < 0.005))
    if (!allMatch) failures.push(failure('NUMERIC_MISMATCH', 'CRITICAL', 'Um ou mais valores monetários da resposta divergem dos valores contábeis verificados.'))
    for (const claim of claims.filter((item) => item.claimType === 'NUMERIC')) {
      const values = extractMoney(claim.claim)
      if (values.length > 0) claim.verified = allMatch && values.every((value) => expectedAmounts.some((expected) => Math.abs(value - expected) < 0.005))
      claim.score = claim.verified ? 1 : 0
    }
    return allMatch ? 1 : 0
  }

  private verifyPercentages(text: string, failures: EvaluationFailure[]): number {
    const percentages = extractPercentages(text)
    if (percentages.some((value) => value < 0 || value > 100)) {
      failures.push(failure('INVALID_PERCENTAGE', 'CRITICAL', 'A resposta contém percentual fora do intervalo matematicamente válido.'))
      return 0
    }
    return 1
  }

  private applySemanticChecks(claims: EvaluationClaim[], text: string, failures: EvaluationFailure[]): { causality: number; contradictions: number } {
    let causality = 1
    let contradictions = 1
    if (isContradictoryText(text)) {
      contradictions = 0
      failures.push(failure('INTERNAL_CONTRADICTION', 'HIGH', 'Foram detectadas tendências incompatíveis na mesma resposta sem qualificação comparativa suficiente.'))
    }
    for (const claim of claims) {
      if (claim.claimType === 'CAUSAL' && hasUnqualifiedCausalLanguage(claim.claim)) {
        claim.score = Math.min(claim.score || 1, 0.5)
        causality = 0.5
        failures.push(failure('CAUSAL_OVERCLAIM', 'HIGH', `Afirmação causal sem sustentação explícita: ${claim.claim}`))
      }
    }
    return { causality, contradictions }
  }

  private applyFreshness(claims: EvaluationClaim[], gate: GateContext, failures: EvaluationFailure[]): number {
    const liveClaims = claims.filter((claim) => isLiveClaim(claim.claim))
    const stale = liveClaims.filter((claim) => claim.freshnessSeconds !== undefined && claim.freshnessSeconds > LIVE_FRESHNESS_SECONDS)
    if (stale.length > 0) {
      failures.push(failure('STALE_LIVE_EVIDENCE', gate === GateContext.READ ? 'MEDIUM' : 'HIGH', `Evidência de estado atual excede a janela de ${LIVE_FRESHNESS_SECONDS}s.`))
      stale.forEach((claim) => { claim.verified = false; claim.score = 0 })
      return 0
    }
    return 1
  }

  private decide(gate: GateContext, scores: DimensionScores, failures: EvaluationFailure[]): EvaluationVerdict {
    const critical = failures.some((item) => item.severity === 'CRITICAL')
    const high = failures.some((item) => item.severity === 'HIGH')
    if (critical) return EvaluationVerdict.BLOCK
    if (gate !== GateContext.READ && (high || scores.groundingFactCheck < 0.8 || scores.mathematicalAccuracy < 1 || scores.tenantIsolationSecurity < 1)) return EvaluationVerdict.BLOCK
    if (high || scores.causalityValidation < 1 || scores.absenceOfContradictions < 1 || scores.groundingFactCheck < 0.8) return EvaluationVerdict.REVIEW
    return EvaluationVerdict.PASS
  }

  async auditIaraOutput(output: GeneratedIaraOutput, gate: GateContext): Promise<AuditEvaluationReport> {
    if (!output.tenantId || !output.responseText.trim()) throw new Error('Contexto de avaliação inválido.')
    const evaluationId = crypto.randomUUID()
    const claims = extractClaims(output.responseText)
    const failures: EvaluationFailure[] = []
    const anomalies: string[] = []

    try {
      const entities = await this.verifyEntities(output.responseText, output.tenantId, claims, failures)
      const mathematicalAccuracy = Math.min(this.verifyNumbers(output.responseText, entities, claims, failures), this.verifyPercentages(output.responseText, failures))
      const semantic = this.applySemanticChecks(claims, output.responseText, failures)
      const freshness = this.applyFreshness(claims, gate, failures)
      const groundedClaims = claims.filter((claim) => claim.evidence.length > 0)
      const grounding = claims.length === 0 ? 0 : clamp(groundedClaims.filter((claim) => claim.verified).length / claims.length)
      const tenantIsolation = failures.some((item) => item.failureCode === 'TENANT_ISOLATION_VIOLATION') ? 0 : 1
      const toolCalls = output.toolCalls ?? []
      const toolAccuracy = toolCalls.length === 0 ? 1 : clamp(toolCalls.filter((call) => call.schemaValid && call.authorized && call.resultValid).length / toolCalls.length)
      if (toolCalls.some((call) => !call.authorized)) failures.push(failure('UNAUTHORIZED_TOOL_CALL', 'CRITICAL', 'A resposta foi produzida a partir de uma chamada de ferramenta não autorizada.'))
      if (toolCalls.some((call) => !call.schemaValid || !call.resultValid)) failures.push(failure('TOOL_CONTRACT_FAILURE', 'HIGH', 'Uma chamada de ferramenta violou o contrato ou retornou resultado inválido.'))

      const scores: DimensionScores = {
        groundingFactCheck: grounding,
        tenantIsolationSecurity: tenantIsolation,
        mathematicalAccuracy,
        causalityValidation: semantic.causality,
        absenceOfContradictions: semantic.contradictions,
      }
      const verdict = this.decide(gate, scores, failures)
      failures.forEach((item) => anomalies.push(item.message))
      const report: AuditEvaluationReport = {
        evaluationId,
        verdict,
        gateEnforced: gate,
        scores,
        detectedAnomalies: anomalies,
        claims,
        failures,
        executionCostUsd: null,
        timestamp: new Date().toISOString(),
      }

      const overallScore = minScore([
        scores.groundingFactCheck,
        scores.tenantIsolationSecurity,
        scores.mathematicalAccuracy,
        scores.causalityValidation,
        scores.absenceOfContradictions,
        freshness,
        toolAccuracy,
      ])
      const hallucinationRisk = clamp(1 - overallScore)
      const assertions = [
        { assertion_type: 'GROUNDING', passed: scores.groundingFactCheck >= 0.8, score: scores.groundingFactCheck, evidence: claims.map((claim) => ({ claim: claim.claim, verified: claim.verified })) },
        { assertion_type: 'TENANT_ISOLATION', passed: scores.tenantIsolationSecurity === 1, score: scores.tenantIsolationSecurity, evidence: entities.map((entity) => ({ kind: entity.kind, id: entity.id, tenantVerified: entity.tenantVerified })) },
        { assertion_type: 'MATHEMATICAL_ACCURACY', passed: scores.mathematicalAccuracy === 1, score: scores.mathematicalAccuracy, evidence: [] },
        { assertion_type: 'CAUSALITY', passed: scores.causalityValidation === 1, score: scores.causalityValidation, evidence: claims.filter((claim) => claim.claimType === 'CAUSAL').map((claim) => ({ claim: claim.claim, score: claim.score })) },
        { assertion_type: 'CONTRADICTIONS', passed: scores.absenceOfContradictions === 1, score: scores.absenceOfContradictions, evidence: [] },
      ]

      const { data, error } = await this.supabase.rpc('persist_iara_independent_evaluation', {
        p_tenant_id: output.tenantId,
        p_execution_id: output.executionId ?? null,
        p_evaluator_version: VERSION,
        p_overall_score: overallScore,
        p_hallucination_risk: hallucinationRisk,
        p_grounding_score: scores.groundingFactCheck,
        p_tool_call_accuracy: toolAccuracy,
        p_evidence_coverage: grounding,
        p_causal_confidence: scores.causalityValidation,
        p_data_confidence: freshness,
        p_total_cost_minor: output.totalCostMinor ?? null,
        p_latency_ms: Number.isInteger(output.latencyMs) ? output.latencyMs : null,
        p_decision: verdict,
        p_summary: verdict === EvaluationVerdict.PASS ? 'Saída verificada independentemente.' : verdict === EvaluationVerdict.REVIEW ? 'Saída requer revisão independente.' : 'Saída bloqueada pelo guardrail independente.',
        p_assertions: assertions,
        p_claims: claims,
        p_failures: failures,
        p_tool_calls: toolCalls,
      })
      if (error) throw new Error(`Falha ao persistir avaliação independente: ${error.message}`)
      if (data && String(data) !== evaluationId) {
        // evaluationId is local correlation; the UUID persisted by Postgres is authoritative.
        report.evaluationId = String(data)
      }
      return report
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida no avaliador independente.'
      const failClosed = gate === GateContext.READ ? EvaluationVerdict.REVIEW : EvaluationVerdict.BLOCK
      return {
        evaluationId,
        verdict: failClosed,
        gateEnforced: gate,
        scores: { groundingFactCheck: 0, tenantIsolationSecurity: 0, mathematicalAccuracy: 0, causalityValidation: 0, absenceOfContradictions: 0 },
        detectedAnomalies: [`INDEPENDENT_EVALUATOR_FAILURE: ${message}`],
        claims,
        failures: [failure('EVALUATOR_FAILURE', 'CRITICAL', message)],
        executionCostUsd: null,
        timestamp: new Date().toISOString(),
      }
    }
  }
}
