import type { IaraExecutionGuardrail } from './execution-kernel'
import type { IaraRiskClass, IaraToolCall, IaraToolContext } from './contracts'
import { GateContext, IaraIndependentEvaluator } from '../IaraIndependentEvaluator'

function gateForRisk(riskClass: IaraRiskClass): GateContext {
  if (riskClass === 'critical' || riskClass === 'high') return GateContext.FINANCIAL
  if (riskClass === 'medium' || riskClass === 'low') return GateContext.OPERATIONAL
  return GateContext.READ
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
