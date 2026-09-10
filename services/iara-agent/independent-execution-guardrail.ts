import type { IaraExecutionGuardrail } from './execution-kernel'
import type { IaraRiskClass, IaraToolCall, IaraToolContext } from './contracts'
import { GateContext, IaraIndependentEvaluator } from '../IaraIndependentEvaluator'

function gateForRisk(riskClass: IaraRiskClass): GateContext {
  if (riskClass === 'critical' || riskClass === 'high') return GateContext.FINANCIAL
  if (riskClass === 'medium' || riskClass === 'low') return GateContext.OPERATIONAL
  return GateContext.READ
}

function containsExternallyVerifiableReference(input: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(input)
  return /\btx_[A-Za-z0-9_-]+\b|\bprod_[A-Za-z0-9_-]+\b|R\$\s*[0-9]/i.test(serialized)
}

export class IaraIndependentExecutionGuardrail implements IaraExecutionGuardrail {
  constructor(
    private readonly evaluator: IaraIndependentEvaluator,
    private readonly riskResolver: (tool: IaraToolCall) => IaraRiskClass,
  ) {}

  async beforeExecute(input: {
    executionId: string
    tool: IaraToolCall
    context: IaraToolContext
  }): Promise<{ allowed: boolean; reason: string }> {
    const riskClass = this.riskResolver(input.tool)

    // Purely contextual tools without externally verifiable business entities
    // still pass through canonical authorization; there is no invented evidence
    // to verify. The independent evaluator is invoked when the input contains
    // business references that can be checked against the authoritative store.
    if (!containsExternallyVerifiableReference(input.tool.input)) {
      return { allowed: true, reason: 'No externally verifiable business reference was present; canonical authorization remains authoritative.' }
    }

    const report = await this.evaluator.auditIaraOutput(
      {
        tenantId: input.context.tenantId,
        responseText: JSON.stringify(input.tool.input),
        invokedTool: input.tool.toolKey,
        toolPayloadStr: JSON.stringify(input.tool.input),
        latencyMs: 0,
        executionId: input.executionId,
        toolCalls: [
          {
            toolKey: input.tool.toolKey,
            requestedInput: input.tool.input,
            schemaValid: true,
            authorized: true,
            resultValid: true,
          },
        ],
      },
      gateForRisk(riskClass),
    )

    if (report.verdict === 'BLOCK') {
      return {
        allowed: false,
        reason: report.failures.map((item) => item.message).join(' | ') || 'Independent evaluator rejected the execution.',
      }
    }

    if (report.verdict === 'REVIEW' && riskClass !== 'read') {
      return {
        allowed: false,
        reason: report.failures.map((item) => item.message).join(' | ') || 'Independent evaluator requires review before execution.',
      }
    }

    return { allowed: true, reason: 'Independent evaluation passed the pre-execution guard.' }
  }
}
