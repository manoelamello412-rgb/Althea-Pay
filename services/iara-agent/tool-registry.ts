import type { SupabaseClient } from '@supabase/supabase-js'
import type { IaraRiskClass, IaraToolContext, IaraToolDefinition } from './contracts'
import { IaraCausalityEngine } from '../IaraCausalityEngine'
import { IaraForecastingEngine } from '../IaraForecastingEngine'

export interface IaraRegisteredTool<TInput extends object = object, TOutput = unknown> extends IaraToolDefinition<TInput, TOutput> {
  displayName: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  enabled: boolean
}

type StoredIaraTool = IaraRegisteredTool<Record<string, unknown>, unknown>

export interface IaraToolRegistryStore {
  listEnabled(): Promise<ReadonlyArray<StoredIaraTool>>
  get(toolKey: string, version: number): Promise<StoredIaraTool | null>
}

export class IaraToolRegistry {
  private readonly tools = new Map<string, StoredIaraTool>()

  register<TInput extends object, TOutput>(tool: IaraRegisteredTool<TInput, TOutput>): void {
    if (!tool.key.trim()) throw new Error('IARA tool key is required.')
    if (!Number.isInteger(tool.version) || tool.version < 1) throw new Error('IARA tool version is invalid.')
    if (!tool.permissionCode.trim()) throw new Error('IARA tool permission is required.')

    const storedTool: StoredIaraTool = {
      ...tool,
      execute: async (input: Record<string, unknown>, context: IaraToolContext): Promise<unknown> =>
        tool.execute(input as TInput, context),
    }

    this.tools.set(`${tool.key}@${tool.version}`, storedTool)
  }

  resolve(toolKey: string, version: number): StoredIaraTool | null {
    const tool = this.tools.get(`${toolKey}@${version}`)
    return tool?.enabled ? tool : null
  }

  listEnabled(): ReadonlyArray<StoredIaraTool> {
    return [...this.tools.values()].filter((tool) => tool.enabled)
  }

  hasRiskAtMost(tool: StoredIaraTool, maximum: IaraRiskClass): boolean {
    const order: Record<IaraRiskClass, number> = { read: 0, low: 1, medium: 2, high: 3, critical: 4 }
    return order[tool.riskClass] <= order[maximum]
  }
}

export function registerOperationalIntelligenceTools(
  registry: IaraToolRegistry,
  supabase: SupabaseClient,
): void {
  const forecasting = new IaraForecastingEngine({ supabase })
  const causality = new IaraCausalityEngine({ supabase })

  registry.register({
    key: 'forecast_metric',
    version: 1,
    displayName: 'Forecast metric',
    description: 'Forecast a tenant-scoped operational metric from persisted telemetry.',
    riskClass: 'read',
    permissionCode: 'iara.operational_intelligence.read',
    idempotencyRequired: false,
    confirmationRequired: false,
    enabled: true,
    inputSchema: {
      type: 'object',
      required: ['metric'],
      properties: {
        metric: { type: 'string', minLength: 1, maxLength: 120 },
        horizon: { type: 'integer', minimum: 1, maximum: 168 },
        entityType: { type: 'string', maxLength: 120 },
        entityId: { type: 'string', maxLength: 120 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: ['object', 'null'] },
    execute: async (input, context: IaraToolContext) => forecasting.forecast({
      tenantId: context.tenantId,
      metric: String(input.metric),
      horizon: input.horizon === undefined ? undefined : Number(input.horizon),
      executionId: context.executionId,
      entityType: input.entityType === undefined ? undefined : String(input.entityType),
      entityId: input.entityId === undefined ? undefined : String(input.entityId),
    }),
  })

  registry.register({
    key: 'diagnose_metric_causality',
    version: 1,
    displayName: 'Diagnose metric causality',
    description: 'Assess temporal associations around an observed metric effect without claiming unsupported causality.',
    riskClass: 'read',
    permissionCode: 'iara.operational_intelligence.read',
    idempotencyRequired: false,
    confirmationRequired: false,
    enabled: true,
    inputSchema: {
      type: 'object',
      required: ['metric', 'observedEffect'],
      properties: {
        metric: { type: 'string', minLength: 1, maxLength: 120 },
        observedEffect: { type: 'number' },
        candidateMetrics: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 120 }, maxItems: 10 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    execute: async (input, context: IaraToolContext) => causality.diagnose({
      tenantId: context.tenantId,
      metric: String(input.metric),
      observedEffect: Number(input.observedEffect),
      executionId: context.executionId,
      candidateMetrics: Array.isArray(input.candidateMetrics) ? input.candidateMetrics.map(String) : undefined,
    }),
  })
}
