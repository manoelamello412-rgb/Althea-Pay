import type {
  IaraToolCall,
  IaraToolContext,
  IaraToolDefinition,
  IaraExecutionResult,
} from './contracts'
import { authorizeTool, type IaraAuthorizationPolicy } from './authorization'

export class IaraToolRegistry {
  private readonly tools = new Map<string, IaraToolDefinition>()

  public register<TInput extends object, TOutput>(tool: IaraToolDefinition<TInput, TOutput>): void {
    const key = `${tool.key}@${tool.version}`
    if (this.tools.has(key)) throw new Error(`IARA tool already registered: ${key}`)
    this.tools.set(key, tool as IaraToolDefinition)
  }

  public get(key: string, version: number): IaraToolDefinition | undefined {
    return this.tools.get(`${key}@${version}`)
  }

  public list(): ReadonlyArray<IaraToolDefinition> {
    return [...this.tools.values()]
  }

  public async execute(
    call: IaraToolCall,
    context: IaraToolContext,
    policy: IaraAuthorizationPolicy,
  ): Promise<IaraExecutionResult> {
    const tool = this.get(call.toolKey, call.version)
    if (!tool) {
      return { executionId: context.executionId, status: 'failed', error: 'IARA tool not found.' }
    }

    const authorization = authorizeTool(tool, policy)
    if (!authorization.allowed) {
      return { executionId: context.executionId, status: 'failed', error: authorization.reason }
    }
    if (authorization.requiresConfirmation) {
      return { executionId: context.executionId, status: 'awaiting_confirmation', error: authorization.reason }
    }

    try {
      const result = await tool.execute(call.input, context)
      return { executionId: context.executionId, status: 'completed', result }
    } catch (error: unknown) {
      return {
        executionId: context.executionId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'IARA tool execution failed.',
      }
    }
  }
}
