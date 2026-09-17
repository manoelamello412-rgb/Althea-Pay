import {
  PaymentOsError,
  type PaymentFlow,
  type PaymentFlowStep,
  type RoutingContext,
  type RoutingConditions,
  type RoutingDecision,
} from './types'

function matchesConditions(conditions: RoutingConditions, context: RoutingContext): boolean {
  if (conditions.minAmount !== undefined && context.amount < conditions.minAmount) return false
  if (conditions.maxAmount !== undefined && context.amount > conditions.maxAmount) return false
  if (conditions.currencies?.length && !conditions.currencies.includes(context.currency)) return false
  if (conditions.methods?.length && !conditions.methods.includes(context.method)) return false
  if (conditions.cardBrands?.length && (!context.cardBrand || !conditions.cardBrands.includes(context.cardBrand))) return false
  if (conditions.installmentsMin !== undefined && (context.installments ?? 1) < conditions.installmentsMin) return false
  if (conditions.installmentsMax !== undefined && (context.installments ?? 1) > conditions.installmentsMax) return false
  if (conditions.countries?.length && (!context.country || !conditions.countries.includes(context.country))) return false
  return true
}

export function resolveRoute(flow: PaymentFlow, context: RoutingContext): RoutingDecision {
  const steps = flow.steps
    .filter((step) => step.enabled && step.method === context.method)
    .sort((a, b) => a.stepOrder - b.stepOrder)

  if (!steps.length) {
    throw new PaymentOsError('NO_ROUTE', `No published route exists for ${context.method}.`)
  }

  const deterministic = steps.find((step) => matchesConditions(step.conditions, context))
  if (deterministic) return { step: deterministic, reason: 'condition_match' }

  const fallback = steps.find((step) => step.action === 'fallback') ?? steps[0]
  return { step: fallback, reason: 'fallback' }
}

export function getOrderedFallbacks(flow: PaymentFlow, currentStep: PaymentFlowStep): PaymentFlowStep[] {
  return flow.steps
    .filter(
      (step) =>
        step.enabled &&
        step.method === currentStep.method &&
        step.stepOrder > currentStep.stepOrder &&
        (step.action === 'fallback' || step.action === 'route'),
    )
    .sort((a, b) => a.stepOrder - b.stepOrder)
}
