import type { IaraExecutionResult, IaraToolCall, IaraToolContext } from './contracts'
import { authorizeTool, type IaraAuthorizationPolicy } from './authorization'
import { IaraToolRegistry } from './tool-registry'

export interface IaraApprovalVerifier {
  verify(input: { executionId: string; tool: IaraToolCall; context: IaraToolContext }): Promise<boolean>
}

export interface IaraExecutionAudit {
  record(input: { executionId: string; tool: IaraToolCall; status: IaraExecutionResult['status']; error?: string }): Promise<void>
}

export class IaraExecutionKernel {
  constructor(
    private readonly registry: IaraToolRegistry,
    private readonly policy: IaraAuthorizationPolicy,
    private readonly approvals?: IaraApprovalVerifier,
    private readonly audit?: IaraExecutionAudit,
  ) {}

  async execute(call: IaraToolCall, context: IaraToolContext): Promise<IaraExecutionResult> {
    const tool = this.registry.resolve(call.toolKey, call.version)
    if (!tool) {
      const result: IaraExecutionResult = { executionId: context.executionId, status: 'failed', error: 'IARA tool is unavailable.' }
      await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: result.error })
      return result
    }

    const decision = authorizeTool(tool, this.policy)
    if (!decision.allowed) {
      const result: IaraExecutionResult = { executionId: context.executionId, status: 'failed', error: decision.reason }
      await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: result.error })
      return result
    }

    if (decision.requiresConfirmation) {
      const approved = await this.approvals?.verify({ executionId: context.executionId, tool: call, context })
      if (!approved) {
        const result: IaraExecutionResult = { executionId: context.executionId, status: 'awaiting_confirmation' }
        await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status })
        return result
      }
    }

    try {
      const value = await tool.execute(call.input, context)
      const result: IaraExecutionResult = { executionId: context.executionId, status: 'completed', result: value }
      await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IARA tool execution failed.'
      const result: IaraExecutionResult = { executionId: context.executionId, status: 'failed', error: message }
      await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: message })
      return result
    }
  }
}
