import type { IaraExecutionResult, IaraToolCall, IaraToolContext } from './contracts'
import { authorizeTool, type IaraAuthorizationPolicy } from './authorization'
import { IaraToolRegistry } from './tool-registry'
import { IaraIdempotencyStore } from './idempotency-store'

export interface IaraApprovalVerifier {
  verify(input: { executionId: string; tool: IaraToolCall; context: IaraToolContext }): Promise<boolean>
}

export interface IaraExecutionAudit {
  record(input: { executionId: string; tool: IaraToolCall; status: IaraExecutionResult['status']; error?: string }): Promise<void>
}

export interface IaraExecutionGuardrail {
  /**
   * Runs after canonical authorization/confirmation and before the tool side effect.
   * Returning false is a hard deny: the tool is never invoked.
   */
  beforeExecute(input: {
    executionId: string
    tool: IaraToolCall
    context: IaraToolContext
  }): Promise<{ allowed: boolean; reason: string }>
}

export class IaraExecutionKernel {
  constructor(
    private readonly registry: IaraToolRegistry,
    private readonly policy: IaraAuthorizationPolicy,
    private readonly approvals?: IaraApprovalVerifier,
    private readonly audit?: IaraExecutionAudit,
    private readonly idempotency?: IaraIdempotencyStore,
    private readonly guardrail?: IaraExecutionGuardrail,
  ) {}

  async execute(call: IaraToolCall, context: IaraToolContext): Promise<IaraExecutionResult> {
    const tool = this.registry.resolve(call.toolKey, call.version)
    if (!tool) return this.finish(call, { executionId: context.executionId, status: 'failed', error: 'IARA tool is unavailable.' })

    const decision = authorizeTool(tool, this.policy)
    if (!decision.allowed) return this.finish(call, { executionId: context.executionId, status: 'failed', error: decision.reason })

    if (decision.requiresConfirmation) {
      const approved = await this.approvals?.verify({ executionId: context.executionId, tool: call, context })
      if (!approved) return this.finish(call, { executionId: context.executionId, status: 'awaiting_confirmation' })
    }

    const idempotencyKey = call.idempotencyKey?.trim()
    if (tool.idempotencyRequired && !idempotencyKey) {
      return this.finish(call, { executionId: context.executionId, status: 'failed', error: 'Idempotency key is required for this tool.' })
    }
    if (tool.idempotencyRequired && !this.idempotency) {
      return this.finish(call, { executionId: context.executionId, status: 'failed', error: 'Idempotency store is unavailable for this tool.' })
    }

    if (tool.idempotencyRequired && idempotencyKey && this.idempotency) {
      const claim = await this.idempotency.claim({ tenantId: context.tenantId, idempotencyKey, call, executionId: context.executionId })
      if (claim.kind === 'conflict') return this.finish(call, { executionId: context.executionId, status: 'failed', error: 'Idempotency key was already used for a different request.' })
      if (claim.kind === 'in_flight') return this.finish(call, { executionId: claim.record.executionId, status: 'failed', error: 'An equivalent IARA execution is already in progress.' })
      if (claim.kind === 'replay') {
        if (claim.record.status === 'COMPLETED') return this.finish(call, { executionId: claim.record.executionId, status: 'completed', result: claim.record.result })
        return this.finish(call, { executionId: claim.record.executionId, status: 'failed', error: claim.record.error ?? 'Previous idempotent execution failed.' })
      }
    }

    if (this.guardrail) {
      const guard = await this.guardrail.beforeExecute({ executionId: context.executionId, tool: call, context })
      if (!guard.allowed) {
        if (tool.idempotencyRequired && idempotencyKey && this.idempotency) {
          await this.idempotency.fail(context.tenantId, idempotencyKey, guard.reason)
        }
        return this.finish(call, { executionId: context.executionId, status: 'failed', error: `IARA independent guardrail blocked execution: ${guard.reason}` })
      }
    }

    try {
      const value = await tool.execute(call.input, context)
      if (tool.idempotencyRequired && idempotencyKey && this.idempotency) await this.idempotency.complete(context.tenantId, idempotencyKey, value)
      return this.finish(call, { executionId: context.executionId, status: 'completed', result: value })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IARA tool execution failed.'
      if (tool.idempotencyRequired && idempotencyKey && this.idempotency) await this.idempotency.fail(context.tenantId, idempotencyKey, message)
      return this.finish(call, { executionId: context.executionId, status: 'failed', error: message })
    }
  }

  private async finish(call: IaraToolCall, result: IaraExecutionResult): Promise<IaraExecutionResult> {
    await this.audit?.record({ executionId: result.executionId, tool: call, status: result.status, error: result.error })
    return result
  }
}
