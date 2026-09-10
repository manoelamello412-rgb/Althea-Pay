import type { IaraRiskClass, IaraToolDefinition } from './contracts'

export interface IaraRegisteredTool<TInput extends object = object, TOutput = unknown> extends IaraToolDefinition<TInput, TOutput> {
  displayName: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  enabled: boolean
}

export interface IaraToolRegistryStore {
  listEnabled(): Promise<ReadonlyArray<IaraRegisteredTool>>
  get(toolKey: string, version: number): Promise<IaraRegisteredTool | null>
}

export class IaraToolRegistry {
  private readonly tools = new Map<string, IaraRegisteredTool>()

  register<TInput extends object, TOutput>(tool: IaraRegisteredTool<TInput, TOutput>): void {
    if (!tool.key.trim()) throw new Error('IARA tool key is required.')
    if (!Number.isInteger(tool.version) || tool.version < 1) throw new Error('IARA tool version is invalid.')
    if (!tool.permissionCode.trim()) throw new Error('IARA tool permission is required.')
    this.tools.set(`${tool.key}@${tool.version}`, tool)
  }

  resolve(toolKey: string, version: number): IaraRegisteredTool | null {
    const tool = this.tools.get(`${toolKey}@${version}`)
    return tool?.enabled ? tool : null
  }

  listEnabled(): ReadonlyArray<IaraRegisteredTool> {
    return [...this.tools.values()].filter((tool) => tool.enabled)
  }

  hasRiskAtMost(tool: IaraRegisteredTool, maximum: IaraRiskClass): boolean {
    const order: Record<IaraRiskClass, number> = { read: 0, low: 1, medium: 2, high: 3, critical: 4 }
    return order[tool.riskClass] <= order[maximum]
  }
}
