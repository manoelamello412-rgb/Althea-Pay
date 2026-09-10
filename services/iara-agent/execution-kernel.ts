import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IaraExecutionResult, IaraToolCall, IaraToolContext } from './contracts'
import { authorizeTool, type IaraAuthorizationPolicy } from './authorization'
import { IaraToolRegistry } from './tool-registry'

export interface IaraApprovalVerifier {
  verify(input: { executionId: string; tool: IaraToolCall; context: IaraToolContext }): Promise<boolean>
}

export interface IaraExecutionAudit {
  record(input: { executionId: string; tool: IaraToolCall; status: IaraExecutionResult['status']; error?: string }): Promise<void>
}

interface IaraIdempotencyRecord {
  tenant_id: string
  idempotency_key: string
  tool_key: string
  tool_version: number
  request_hash: string
  execution_id: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED'
  result: unknown
  error: string | null
}

export interface IaraIdempotencyStore {
  claim(input: {
    tenantId: string
    idempotencyKey: string
    toolKey: string
    toolVersion: number
    requestHash: string
    executionId: string
  }): Promise<{ claimed: true } | { claimed: false; record: IaraIdempotencyRecord }>

  complete(input: {
    tenantId: string
    idempotencyKey: string
    status: 'COMPLETED' | 'FAILED'
    result?: unknown
    error?: string
  }): Promise<void>
}

export class SupabaseIaraIdempotencyStore implements IaraIdempotencyStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claim(input: {
    tenantId: string
    idempotencyKey: string
    toolKey: string
    toolVersion: number
    requestHash: string
    executionId: string
  }): Promise<{ claimed: true } | { claimed: false; record: IaraIdempotencyRecord }> {
    const { error } = await this.supabase.from('iara_execution_idempotency').insert({
      tenant_id: input.tenantId,
      idempotency_key: input.idempotencyKey,
      tool_key: input.toolKey,
      tool_version: input.toolVersion,
      request_hash: input.requestHash,
      execution_id: input.executionId,
      status: 'RUNNING',
    })

    if (!error) return { claimed: true }

    const { data, error: readError } = await this.supabase
      .from('iara_execution_idempotency')
      .select('tenant_id,idempotency_key,tool_key,tool_version,request_hash,execution_id,status,result,error')
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()

    if (readError) throw new Error(`IARA idempotency lookup failed: ${readError.message}`)
    if (!data) throw new Error(`IARA idempotency claim failed: ${error.message}`)

    const record = data as IaraIdempotencyRecord
    if (record.tool_key !== input.toolKey || record.tool_version !== input.toolVersion || record.request_hash !== input.requestHash) {
      throw new Error('IARA idempotency key was reused with a different request.')
    }

    return { claimed: false, record }
  }

  async complete(input: {
    tenantId: string
    idempotencyKey: string
    status: 'COMPLETED' | 'FAILED'
    result?: unknown
    error?: string
  }): Promise<void> {
    const { error } = await this.supabase
      .from('iara_execution_idempotency')
      .update({
        status: input.status,
        result: input.result === undefined ? null : input.result,
        error: input.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .eq('status', 'RUNNING')

    if (error) throw new Error(`IARA idempotency completion failed: ${error.message}`)
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

function hashToolRequest(call: IaraToolCall): string {
  return createHash('sha256').update(stableSerialize({ toolKey: call.toolKey, version: call.version, input: call.input })).digest('hex')
}

export class IaraExecutionKernel {
  constructor(
    private readonly registry: IaraToolRegistry,
    private readonly policy: IaraAuthorizationPolicy,
    private readonly approvals?: IaraApprovalVerifier,
    private readonly audit?: IaraExecutionAudit,
    private readonly idempotency?: IaraIdempotencyStore,
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

    if (tool.idempotencyRequired) {
      if (!this.idempotency) {
        const result: IaraExecutionResult = { executionId: context.executionId, status: 'failed', error: 'IARA idempotency store is not configured for this tool.' }
        await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: result.error })
        return result
      }
      if (!call.idempotencyKey?.trim()) {
        const result: IaraExecutionResult = { executionId: context.executionId, status: 'failed', error: 'IARA idempotency key is required for this tool.' }
        await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: result.error })
        return result
      }

      const claim = await this.idempotency.claim({
        tenantId: context.tenantId,
        idempotencyKey: call.idempotencyKey,
        toolKey: call.toolKey,
        toolVersion: call.version,
        requestHash: hashToolRequest(call),
        executionId: context.executionId,
      })

      if (!claim.claimed) {
        if (claim.record.status === 'RUNNING') {
          const result: IaraExecutionResult = { executionId: context.executionId, status: 'awaiting_confirmation', error: 'IARA execution with this idempotency key is already running.' }
          await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: result.error })
          return result
        }
        const result: IaraExecutionResult = {
          executionId: claim.record.execution_id,
          status: claim.record.status === 'COMPLETED' ? 'completed' : 'failed',
          result: claim.record.result,
          error: claim.record.error ?? undefined,
        }
        await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: result.error })
        return result
      }

      try {
        const value = await tool.execute(call.input, context)
        await this.idempotency.complete({ tenantId: context.tenantId, idempotencyKey: call.idempotencyKey, status: 'COMPLETED', result: value })
        const result: IaraExecutionResult = { executionId: context.executionId, status: 'completed', result: value }
        await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'IARA tool execution failed.'
        await this.idempotency.complete({ tenantId: context.tenantId, idempotencyKey: call.idempotencyKey, status: 'FAILED', error: message })
        const result: IaraExecutionResult = { executionId: context.executionId, status: 'failed', error: message }
        await this.audit?.record({ executionId: context.executionId, tool: call, status: result.status, error: message })
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
