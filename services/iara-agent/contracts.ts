export const IARA_RISK_CLASSES = ['read', 'low', 'medium', 'high', 'critical'] as const
export type IaraRiskClass = (typeof IARA_RISK_CLASSES)[number]

export interface IaraToolContext {
  userId: string
  tenantId: string
  sessionId: string
  executionId: string
  requestId: string
}

export interface IaraToolDefinition<TInput extends object = object, TOutput = unknown> {
  key: string
  version: number
  description: string
  riskClass: IaraRiskClass
  permissionCode: string
  idempotencyRequired: boolean
  confirmationRequired: boolean
  execute(input: TInput, context: IaraToolContext): Promise<TOutput>
}

export interface IaraToolCall {
  toolKey: string
  version: number
  input: Record<string, unknown>
  idempotencyKey?: string
}

export interface IaraExecutionPlan {
  intent: string
  rationale: string
  calls: IaraToolCall[]
  riskClass: IaraRiskClass
  requiresConfirmation: boolean
}

export interface IaraAuthorizationDecision {
  allowed: boolean
  requiresConfirmation: boolean
  reason: string
}

export interface IaraExecutionResult<T = unknown> {
  executionId: string
  status: 'completed' | 'failed' | 'awaiting_confirmation'
  result?: T
  error?: string
}
