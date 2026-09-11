export type IaraActionType =
  | 'payment_follow_up'
  | 'sales_follow_up'
  | 'recovery_follow_up'
  | 'qualification'
  | 'upsell_or_post_sale'

export interface IaraToolDefinition {
  readonly name: IaraActionType
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly authorization: 'authenticated_owner'
  readonly confirmation: 'human_approval'
  readonly risk: 'operational'
  readonly tenantScope: 'user_id'
  readonly executor: 'crm_execute_ai_action'
}

const textDraftSchema = {
  type: 'object',
  properties: { ai_draft: { type: 'string', minLength: 1, maxLength: 4000 } },
  required: ['ai_draft'],
  additionalProperties: false,
} as const

const executionResultSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    action_id: { type: 'string' },
    status: { type: 'string' },
    executed_at: { type: 'string' },
    message: { type: 'object' },
  },
  required: ['ok', 'action_id', 'status'],
  additionalProperties: true,
} as const

const definitions: Readonly<Record<IaraActionType, IaraToolDefinition>> = {
  payment_follow_up: { name: 'payment_follow_up', inputSchema: textDraftSchema, outputSchema: executionResultSchema, authorization: 'authenticated_owner', confirmation: 'human_approval', risk: 'operational', tenantScope: 'user_id', executor: 'crm_execute_ai_action' },
  sales_follow_up: { name: 'sales_follow_up', inputSchema: textDraftSchema, outputSchema: executionResultSchema, authorization: 'authenticated_owner', confirmation: 'human_approval', risk: 'operational', tenantScope: 'user_id', executor: 'crm_execute_ai_action' },
  recovery_follow_up: { name: 'recovery_follow_up', inputSchema: textDraftSchema, outputSchema: executionResultSchema, authorization: 'authenticated_owner', confirmation: 'human_approval', risk: 'operational', tenantScope: 'user_id', executor: 'crm_execute_ai_action' },
  qualification: { name: 'qualification', inputSchema: textDraftSchema, outputSchema: executionResultSchema, authorization: 'authenticated_owner', confirmation: 'human_approval', risk: 'operational', tenantScope: 'user_id', executor: 'crm_execute_ai_action' },
  upsell_or_post_sale: { name: 'upsell_or_post_sale', inputSchema: textDraftSchema, outputSchema: executionResultSchema, authorization: 'authenticated_owner', confirmation: 'human_approval', risk: 'operational', tenantScope: 'user_id', executor: 'crm_execute_ai_action' },
}

export function getIaraToolDefinition(actionType: string): IaraToolDefinition | null {
  if (!Object.prototype.hasOwnProperty.call(definitions, actionType)) return null
  return definitions[actionType as IaraActionType]
}

export function listIaraTools(): readonly IaraToolDefinition[] {
  return Object.values(definitions)
}
