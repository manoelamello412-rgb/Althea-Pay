import { PaymentOsError, type PaymentFlow, type PaymentFlowStep, type PaymentMethod, type RoutingConditions, type RoutingAction } from './types'

export type PaymentFlowDraft = {
  id: string
  funnelId: string
  name: string
  versionId: string
  version: number
  steps: PaymentFlowStep[]
}

export type AddStepInput = {
  gatewayConnectionId: string
  method: PaymentMethod
  action?: RoutingAction
  conditions?: RoutingConditions
  retryableStatuses?: string[]
  maxAttempts?: number
  enabled?: boolean
}

export class PaymentFlowBuilder {
  private readonly draft: PaymentFlowDraft

  constructor(input: Omit<PaymentFlowDraft, 'steps'> & { steps?: PaymentFlowStep[] }) {
    if (!input.id || !input.funnelId || !input.versionId || !input.name.trim()) {
      throw new PaymentOsError('INVALID_PAYMENT_FLOW', 'Payment flow identity is incomplete.')
    }
    this.draft = { ...input, name: input.name.trim(), steps: [...(input.steps ?? [])] }
  }

  addStep(input: AddStepInput): this {
    if (!input.gatewayConnectionId.trim()) {
      throw new PaymentOsError('INVALID_GATEWAY_CONNECTION', 'Gateway connection is required.')
    }
    const maxAttempts = input.maxAttempts ?? 1
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
      throw new PaymentOsError('INVALID_MAX_ATTEMPTS', 'maxAttempts must be an integer between 1 and 5.')
    }
    const nextOrder = this.draft.steps.length === 0 ? 1 : Math.max(...this.draft.steps.map((step) => step.stepOrder)) + 1
    this.draft.steps.push({
      id: crypto.randomUUID(),
      gatewayConnectionId: input.gatewayConnectionId,
      stepOrder: nextOrder,
      method: input.method,
      action: input.action ?? 'route',
      conditions: input.conditions ?? {},
      retryableStatuses: [...(input.retryableStatuses ?? [])],
      maxAttempts,
      enabled: input.enabled ?? true,
    })
    return this
  }

  removeStep(stepId: string): this {
    this.draft.steps = this.draft.steps.filter((step) => step.id !== stepId)
    return this.resequence()
  }

  updateStep(stepId: string, patch: Partial<Omit<PaymentFlowStep, 'id' | 'stepOrder'>>): this {
    const index = this.draft.steps.findIndex((step) => step.id === stepId)
    if (index < 0) throw new PaymentOsError('FLOW_STEP_NOT_FOUND', `Payment flow step "${stepId}" was not found.`)
    const next = { ...this.draft.steps[index], ...patch }
    if (next.maxAttempts < 1 || next.maxAttempts > 5) throw new PaymentOsError('INVALID_MAX_ATTEMPTS', 'maxAttempts must be between 1 and 5.')
    this.draft.steps[index] = next
    return this
  }

  reorder(stepIds: string[]): this {
    const known = new Set(this.draft.steps.map((step) => step.id))
    if (stepIds.length !== this.draft.steps.length || stepIds.some((id) => !known.has(id)) || new Set(stepIds).size !== stepIds.length) {
      throw new PaymentOsError('INVALID_FLOW_ORDER', 'The requested order must contain every flow step exactly once.')
    }
    const byId = new Map(this.draft.steps.map((step) => [step.id, step]))
    this.draft.steps = stepIds.map((id, index) => ({ ...byId.get(id)!, stepOrder: index + 1 }))
    return this
  }

  publish(): PaymentFlow {
    if (this.draft.steps.length === 0) throw new PaymentOsError('EMPTY_PAYMENT_FLOW', 'A payment flow must contain at least one enabled step.')
    if (!this.draft.steps.some((step) => step.enabled && step.action !== 'park')) {
      throw new PaymentOsError('NO_ROUTABLE_STEP', 'A published payment flow requires at least one enabled routable step.')
    }
    return {
      id: this.draft.id,
      funnelId: this.draft.funnelId,
      versionId: this.draft.versionId,
      version: this.draft.version,
      status: 'published',
      steps: this.draft.steps.map((step) => ({ ...step, conditions: { ...step.conditions }, retryableStatuses: [...step.retryableStatuses] })),
    }
  }

  snapshot(): PaymentFlowDraft {
    return structuredClone(this.draft)
  }

  private resequence(): this {
    this.draft.steps = this.draft.steps.map((step, index) => ({ ...step, stepOrder: index + 1 }))
    return this
  }
}
