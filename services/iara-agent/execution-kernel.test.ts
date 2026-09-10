import { describe, expect, it } from 'vitest'
import type { IaraToolContext } from './contracts'
import { IaraExecutionKernel, type IaraIdempotencyStore } from './execution-kernel'
import { IaraToolRegistry, type IaraRegisteredTool } from './tool-registry'

const context: IaraToolContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  executionId: 'execution-1',
  requestId: 'request-1',
}

class MemoryIdempotencyStore implements IaraIdempotencyStore {
  private readonly records = new Map<string, {
    tenant_id: string
    idempotency_key: string
    tool_key: string
    tool_version: number
    request_hash: string
    execution_id: string
    status: 'RUNNING' | 'COMPLETED' | 'FAILED'
    result: unknown
    error: string | null
  }>()

  async claim(input: Parameters<IaraIdempotencyStore['claim']>[0]): ReturnType<IaraIdempotencyStore['claim']> {
    const key = `${input.tenantId}:${input.idempotencyKey}`
    const existing = this.records.get(key)
    if (existing) return { claimed: false, record: existing }
    this.records.set(key, {
      tenant_id: input.tenantId,
      idempotency_key: input.idempotencyKey,
      tool_key: input.toolKey,
      tool_version: input.toolVersion,
      request_hash: input.requestHash,
      execution_id: input.executionId,
      status: 'RUNNING',
      result: null,
      error: null,
    })
    return { claimed: true }
  }

  async complete(input: Parameters<IaraIdempotencyStore['complete']>[0]): Promise<void> {
    const record = this.records.get(`${input.tenantId}:${input.idempotencyKey}`)
    if (!record) throw new Error('missing record')
    record.status = input.status
    record.result = input.result ?? null
    record.error = input.error ?? null
  }
}

function tool(execute: IaraRegisteredTool['execute']): IaraRegisteredTool {
  return {
    key: 'test_idempotent',
    version: 1,
    displayName: 'Test idempotent',
    description: 'Test tool',
    riskClass: 'read',
    permissionCode: 'iara.test.read',
    idempotencyRequired: true,
    confirmationRequired: false,
    enabled: true,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    execute,
  }
}

describe('IaraExecutionKernel idempotency', () => {
  it('executes once and replays the persisted result for a duplicate key', async () => {
    const registry = new IaraToolRegistry()
    let executions = 0
    registry.register(tool(async () => {
      executions += 1
      return { value: 42 }
    }))

    const store = new MemoryIdempotencyStore()
    const kernel = new IaraExecutionKernel(
      registry,
      { allowedPermissionCodes: new Set(['iara.test.read']), maxRiskClass: 'read', allowMutations: false },
      undefined,
      undefined,
      store,
    )

    const first = await kernel.execute({ toolKey: 'test_idempotent', version: 1, input: { b: 2, a: 1 }, idempotencyKey: 'idem-1' }, context)
    const second = await kernel.execute({ toolKey: 'test_idempotent', version: 1, input: { a: 1, b: 2 }, idempotencyKey: 'idem-1' }, { ...context, executionId: 'execution-2' })

    expect(first.status).toBe('completed')
    expect(second.status).toBe('completed')
    expect(second.result).toEqual({ value: 42 })
    expect(executions).toBe(1)
    expect(second.executionId).toBe('execution-1')
  })

  it('rejects reuse of a key for a different request', async () => {
    const registry = new IaraToolRegistry()
    registry.register(tool(async (input) => input))
    const store = new MemoryIdempotencyStore()
    const kernel = new IaraExecutionKernel(
      registry,
      { allowedPermissionCodes: new Set(['iara.test.read']), maxRiskClass: 'read', allowMutations: false },
      undefined,
      undefined,
      store,
    )

    await kernel.execute({ toolKey: 'test_idempotent', version: 1, input: { value: 1 }, idempotencyKey: 'idem-2' }, context)
    await expect(kernel.execute({ toolKey: 'test_idempotent', version: 1, input: { value: 2 }, idempotencyKey: 'idem-2' }, context)).rejects.toThrow('idempotency key was reused')
  })

  it('fails closed when a required idempotency key is absent', async () => {
    const registry = new IaraToolRegistry()
    registry.register(tool(async () => ({ ok: true })))
    const kernel = new IaraExecutionKernel(
      registry,
      { allowedPermissionCodes: new Set(['iara.test.read']), maxRiskClass: 'read', allowMutations: false },
      undefined,
      undefined,
      new MemoryIdempotencyStore(),
    )

    const result = await kernel.execute({ toolKey: 'test_idempotent', version: 1, input: {} }, context)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('idempotency key is required')
  })
})
