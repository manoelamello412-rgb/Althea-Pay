// Canonical AI inference processor for the CRM. Server-side only.

export type CanonicalActionType =
  | 'payment_follow_up'
  | 'sales_follow_up'
  | 'recovery_follow_up'
  | 'qualification'
  | 'upsell_or_post_sale'

export type CanonicalChannel = 'WHATSAPP' | 'SMS' | 'EMAIL'

export interface CustomerContext {
  readonly customerId: string
  readonly conversationId: string
  readonly lifetimeValue: number
  readonly riskScore: number
  readonly lastInteractionDays: number
  readonly openCartsTotal: number
  readonly purchaseHistoryCategories: readonly string[]
  readonly expectedActionType: CanonicalActionType
}

export interface InferenceProvenance {
  readonly endpointHost: string | null
  readonly model: string | null
  readonly responseId: string | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly totalTokens: number | null
  readonly startedAt: string
  readonly completedAt: string
}

export interface GroundedAiResponse {
  readonly action_type: CanonicalActionType
  readonly score: number
  readonly rationale: string
  readonly recommended_channel: CanonicalChannel
  readonly payload: { readonly message_body: string }
  readonly inferenceProvenance: InferenceProvenance
}

type UnknownRecord = Record<string, unknown>
const ACTION_TYPES: readonly CanonicalActionType[] = ['payment_follow_up', 'sales_follow_up', 'recovery_follow_up', 'qualification', 'upsell_or_post_sale']
const CHANNELS: readonly CanonicalChannel[] = ['WHATSAPP', 'SMS', 'EMAIL']
const MAX_RETRIES = 3
const REQUEST_TIMEOUT_MS = 8000
const MAX_RETRY_AFTER_MS = 10000

function env(name: string): string { return process.env[name]?.trim() ?? '' }
function isRecord(value: unknown): value is UnknownRecord { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isCanonicalActionType(value: unknown): value is CanonicalActionType { return typeof value === 'string' && ACTION_TYPES.includes(value as CanonicalActionType) }
function isCanonicalChannel(value: unknown): value is CanonicalChannel { return typeof value === 'string' && CHANNELS.includes(value as CanonicalChannel) }

function safeMessage(value: unknown): string {
  if (typeof value !== 'string') throw new Error('VALIDATION_ERR: payload.message_body inválido.')
  const text = value.trim()
  if (!text || text.length > 4000) throw new Error('VALIDATION_ERR: payload.message_body fora do limite.')
  const forbidden = [/\bgarant(o|imos|ido)?\b/i, /\bsem risco\b/i, /\bR\$\s*\d/i, /\bdesconto\s+de\s+\d/i, /\bpagamento\s+(aprovado|confirmado)\b/i]
  if (forbidden.some((pattern) => pattern.test(text))) throw new Error('VALIDATION_ERR: mensagem contém afirmação financeira não fundamentada.')
  return text
}

function parseProviderResponse(value: unknown): GroundedAiResponse {
  if (!isRecord(value)) throw new Error('AI_INFERENCE_ERR: resposta do provedor não é um objeto.')
  const actionType = value.action_type
  const channel = value.recommended_channel
  const score = value.score
  const rationale = value.rationale
  const payload = value.payload
  if (!isCanonicalActionType(actionType)) throw new Error(`VALIDATION_ERR: action_type inválido: ${String(actionType)}`)
  if (!isCanonicalChannel(channel)) throw new Error(`VALIDATION_ERR: recommended_channel inválido: ${String(channel)}`)
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) throw new Error(`VALIDATION_ERR: score fora do intervalo 0..1: ${String(score)}`)
  if (typeof rationale !== 'string' || !rationale.trim() || rationale.length > 4000) throw new Error('VALIDATION_ERR: rationale ausente ou inválido.')
  if (!isRecord(payload)) throw new Error('VALIDATION_ERR: payload ausente ou inválido.')
  return { action_type: actionType, score, rationale: rationale.trim(), recommended_channel: channel, payload: { message_body: safeMessage(payload.message_body) }, inferenceProvenance: parseInferenceProvenance(value) }
}

function parseInferenceProvenance(value: UnknownRecord): InferenceProvenance {
  const provenance = isRecord(value.inference_provenance) ? value.inference_provenance : {}
  const usage = isRecord(value.usage) ? value.usage : {}
  const integerOrNull = (candidate: unknown): number | null => Number.isInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : null
  const startedAt = typeof provenance.started_at === 'string' ? provenance.started_at : ''
  const completedAt = typeof provenance.completed_at === 'string' ? provenance.completed_at : ''
  if (!startedAt || !completedAt) throw new Error('AI_INFERENCE_ERR: provenance temporal ausente.')
  return {
    endpointHost: typeof provenance.endpoint_host === 'string' ? provenance.endpoint_host : null,
    model: typeof provenance.model === 'string' ? provenance.model : null,
    responseId: typeof provenance.response_id === 'string' ? provenance.response_id : null,
    inputTokens: integerOrNull(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: integerOrNull(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: integerOrNull(usage.total_tokens),
    startedAt,
    completedAt,
  }
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS)
  return null
}
function isRetryableStatus(status: number): boolean { return [408, 409, 425, 429, 500, 502, 503, 504].includes(status) }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Erro de inferência desconhecido.' }

export class AltheaAiInferenceProcessor {
  private readonly llmEndpoint: string
  private readonly aiApiKey: string
  private readonly aiModel: string

  constructor() {
    this.llmEndpoint = env('ALTHEA_AI_BASE_URL') || 'https://api.openai.com/v1/chat/completions'
    this.aiApiKey = env('ALTHEA_AI_API_KEY') || env('OPENAI_API_KEY')
    this.aiModel = env('ALTHEA_AI_MODEL') || 'gpt-5.6-luna'
    if (!this.aiApiKey) throw new Error('AI_INFERENCE_ERR: provedor LLM não configurado.')
  }

  public async generateGroundedAction(context: CustomerContext): Promise<GroundedAiResponse> {
    const prompt = this.buildSystemPrompt(context)
    let delayMs = 250
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const startedAt = new Date().toISOString()
      try {
        const response = await fetch(this.llmEndpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.aiApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.aiModel,
            messages: [
              { role: 'system', content: 'Você é o AI Revenue Agent da ALTHEA PAY. Retorne somente JSON válido. Preserve estritamente o expected_action_type. Nunca invente preços, descontos, status de pagamento, políticas, fatos do cliente, garantias ou ações executadas. Gere somente um rascunho para aprovação humana. Não aplique incentivos financeiros. Responda em português-BR.' },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
          }),
          signal: controller.signal,
          cache: 'no-store',
        })
        clearTimeout(timeoutId)
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response.headers.get('Retry-After')) ?? delayMs))
            delayMs *= 2
            continue
          }
          throw new Error(`LLM_PROVIDER_HTTP_ERR_${response.status}`)
        }
        const data: unknown = await response.json()
        const completedAt = new Date().toISOString()
        if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length === 0 || !isRecord(data.choices[0])) throw new Error('AI_INFERENCE_ERR: resposta sem choices.')
        const message = data.choices[0].message
        if (!isRecord(message) || typeof message.content !== 'string' || !message.content.trim()) throw new Error('AI_INFERENCE_ERR: conteúdo estruturado ausente.')
        const result = parseProviderResponse({ ...JSON.parse(message.content), inference_provenance: { endpoint_host: safeEndpointHost(this.llmEndpoint), model: typeof data.model === 'string' ? data.model : this.aiModel, response_id: typeof data.id === 'string' ? data.id : null, started_at: startedAt, completed_at: completedAt }, usage: data.usage })
        if (result.action_type !== context.expectedActionType) throw new Error('VALIDATION_ERR: modelo tentou alterar a ação determinada pelo motor canônico.')
        return result
      } catch (error: unknown) {
        clearTimeout(timeoutId)
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < MAX_RETRIES) { await new Promise((resolve) => setTimeout(resolve, delayMs)); delayMs *= 2; continue }
          throw new Error(`AI_INFERENCE_TIMEOUT: limite de ${REQUEST_TIMEOUT_MS}ms excedido.`)
        }
        if (error instanceof TypeError && attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, delayMs)); delayMs *= 2; continue
        }
        throw new Error(`AI_INFERENCE_TERMINAL_FAILED: ${errorMessage(error)}`)
      }
    }
    throw new Error('AI_INFERENCE_TERMINAL_FAILED: contrato de inferência não resolvido.')
  }

  private buildSystemPrompt(context: CustomerContext): string {
    return JSON.stringify({
      customer_id: context.customerId,
      conversation_id: context.conversationId,
      expected_action_type: context.expectedActionType,
      lifetime_value: context.lifetimeValue,
      risk_score: context.riskScore,
      last_interaction_days: context.lastInteractionDays,
      open_carts_total: context.openCartsTotal,
      purchase_history_categories: context.purchaseHistoryCategories,
      output_contract: { action_type: 'must equal expected_action_type', score: 'number 0..1', rationale: 'non-empty grounded string', recommended_channel: 'WHATSAPP | SMS | EMAIL', payload: { message_body: 'customer-facing draft only' } },
    })
  }
}

function safeEndpointHost(endpoint: string): string | null {
  try { return new URL(endpoint).hostname || null } catch { return null }
}
