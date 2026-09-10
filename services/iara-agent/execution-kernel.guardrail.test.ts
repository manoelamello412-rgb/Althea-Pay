import { describe, expect, it, vi } from 'vitest'
import { IaraExecutionKernel } from './execution-kernel'
import { IaraToolRegistry } from './tool-registry'
import type { IaraToolCall, IaraToolContext } from './contracts'
import type { IaraExecutionGuardrail } from './execution-kernel'

const context: IaraToolContext = {
  userId: '22222222-2222-4222-8222-222222222222',
  tenantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '33333333-3333-4333-8333-333333333333',
  executionId: '44444444-4444-4444-8444-444444444444',
  requestId: '55555555-5555-4555-8555-555555555555',
}

const call: IaraToolCall = {
  toolKey: 'test.write',
  version: 1,
  input: { value: 'safe' },
}

function createRegistry(execute: () => Promise<unknown>): IaraToolRegistry {
  const registry = new IaraToolRegistry()
  registry.register({
    key: 'test.write',
    version: 1,
    description: 'test',
    displayName: 'Test Write',
    riskClass: 'low',
    permissionCode: 'test.write',
    idempotencyRequired: false,
    confirmationRequired: false,
    inputSchema: {},
    outputSchema: {},
    enabled: true,
    execute,
  })
  return registry
}

describe('IaraExecutionKernel independent guardrail', () => {
  it('never invokes a tool when the independent guardrail blocks', async () => {
    const execute = vi.fn(async () => 'must-not-run')
    const guardrail: IaraExecutionGuardrail = {
      beforeExecute: vi.fn(async () => ({ allowed: false, reason: 'independent verification failed' })),
    }
    const audit = { record: vi.fn(async () => undefined) }
    const kernel = new IaraExecutionKernel(
      createRegistry(execute),
      { allowedPermissionCodes: ['test.write'], maxRiskClass: 'low', allowMutations: true },
      undefined,
      audit,
      undefined,
      guardrail,
    )

    const result = await kernel.execute(call, context)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('independent guardrail')
    expect(execute).not.toHaveBeenCalled()
    expect(guardrail.beforeExecute).toHaveBeenCalledOnce()
  })

  it('invokes the tool only after the independent guardrail allows', async () => {
    const execute = vi.fn(async () => 'executed')
    const guardrail: IaraExecutionGuardrail = {
      beforeExecute: vi.fn(async () => ({ allowed: true, reason: 'verified' })),
    }
    const kernel = new IaraExecutionKernel(
      createRegistry(execute),
      { allowedPermissionCodes: ['test.write'], maxRiskClass: 'low', allowMutations: true },
      undefined,
      undefined,
      undefined,
      guardrail,
    )

    const result = await kernel.execute(call, context)

    expect(result.status).toBe('completed')
    expect(result.result).toBe('executed')
    expect(execute).toHaveBeenCalledOnce()
  })
})
