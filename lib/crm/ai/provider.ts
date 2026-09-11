import {
  AltheaAiInferenceProcessor,
  type CanonicalActionType,
  type CanonicalChannel,
  type CustomerContext,
  type InferenceProvenance,
} from '../ai-inference-processor'

export type RevenueAgentContext = {
  readonly conversationId: string
  readonly recommendation: string
  readonly probability: number
  readonly recoveryProbability: number
  readonly rationale: string
  readonly evidence: Record<string, unknown>
}

export type RevenueAgentDraft = {
  readonly available: boolean
  readonly provider: string
  readonly mode: string
  readonly draft: string | null
  readonly confidence: number
  readonly inferenceProvenance: InferenceProvenance | null
}

const CANONICAL_ACTIONS: readonly CanonicalActionType[] = [
  'payment_follow_up',
  'sales_follow_up',
  'recovery_follow_up',
  'qualification',
  'upsell_or_post_sale',
]

function isCanonicalAction(value: string): value is CanonicalActionType {
  return CANONICAL_ACTIONS.includes(value as CanonicalActionType)
}

function numberFrom(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringArrayFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, 50)
}

function extractCustomerContext(ctx: RevenueAgentContext): CustomerContext {
  const customer360 = ctx.evidence.customer_360
  const c = customer360 && typeof customer360 === 'object' ? customer360 as Record<string, unknown> : {}
  return {
    customerId: typeof c.customer_id === 'string' ? c.customer_id : 'unknown',
    conversationId: ctx.conversationId,
    lifetimeValue: numberFrom(c.lifetime_value, 0),
    riskScore: numberFrom(c.churn_risk_score, numberFrom(c.risk_score, 1 - ctx.probability)),
    lastInteractionDays: numberFrom(c.last_interaction_days, 0),
    openCartsTotal: numberFrom(c.open_carts_total, 0),
    purchaseHistoryCategories: stringArrayFrom(c.purchase_history_categories),
    expectedActionType: ctx.recommendation as CanonicalActionType,
  }
}

export async function generateRevenueAgentDraft(ctx: RevenueAgentContext): Promise<RevenueAgentDraft> {
  if (!isCanonicalAction(ctx.recommendation)) {
    return {
      available: false,
      provider: 'deterministic_only',
      mode: 'grounded_behavioral_fallback',
      draft: null,
      confidence: 0,
      inferenceProvenance: null,
    }
  }

  try {
    const processor = new AltheaAiInferenceProcessor()
    const result = await processor.generateGroundedAction(extractCustomerContext(ctx))
    const channel: CanonicalChannel = result.recommended_channel
    const evidenceCompleteness = ['customer_360', 'next_best_action', 'predictive_scores']
      .filter((key) => key in ctx.evidence).length / 3

    return {
      available: true,
      provider: 'openai_compatible',
      mode: `grounded_llm_draft_v3_${channel.toLowerCase()}`,
      draft: result.payload.message_body,
      confidence: Number((0.55 + 0.3 * evidenceCompleteness).toFixed(2)),
      inferenceProvenance: result.inferenceProvenance,
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'unknown'
    return {
      available: false,
      provider: reason.startsWith('LLM_PROVIDER_HTTP_ERR_') ? 'configured_unavailable' : 'configured_error',
      mode: 'grounded_behavioral_fallback',
      draft: null,
      confidence: 0,
      inferenceProvenance: null,
    }
  }
}
