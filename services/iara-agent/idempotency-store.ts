import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { IaraToolCall } from './contracts'

export type IaraIdempotencyStatus = 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface IaraIdempotencyRecord {
  idempotencyId: string
  tenantId: string
  idempotencyKey: string
  toolKey: string
  toolVersion: number
  requestHash: string
  executionId: string
  status: IaraIdempotencyStatus
  result: unknown
  error: string | null
}

export type IaraIdempotencyClaim =
  | { kind: 'claimed'; record: IaraIdempotencyRecord }
  | { kind: 'replay'; record: IaraIdempotencyRecord }
  | { kind: 'conflict'; record: IaraIdempotencyRecord }
  | { kind: 'in_flight'; record: IaraIdempotencyRecord }

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

export function hashToolRequest(call: IaraToolCall): string {
  return createHash('sha256')
    .update(`${call.toolKey}@${call.version}:${canonicalize(call.input)}`)
    .digest('hex')
}

function mapRecord(row: Record<string, unknown>): IaraIdempotencyRecord {
  return {
    idempotencyId: String(row.idempotency_id),
    tenantId: String(row.tenant_id),
    idempotencyKey: String(row.idempotency_key),
    toolKey: String(row.tool_key),
    toolVersion: Number(row.tool_version),
    requestHash: String(row.request_hash),
    executionId: String(row.execution_id),
    status: row.status as IaraIdempotencyStatus,
    result: row.result,
    error: row.error === null || row.error === undefined ? null : String(row.error),
  }
}

export class IaraIdempotencyStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async claim(input: {
    tenantId: string
    idempotencyKey: string
    call: IaraToolCall
    executionId: string
  }): Promise<IaraIdempotencyClaim> {
    const requestHash = hashToolRequest(input.call)
    const { data: existing, error: lookupError } = await this.supabase
      .from('iara_execution_idempotency')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()

    if (lookupError) throw new Error(`Idempotency lookup failed: ${lookupError.message}`)

    if (existing) {
      const record = mapRecord(existing as Record<string, unknown>)
      if (record.toolKey !== input.call.toolKey || record.toolVersion !== input.call.version || record.requestHash !== requestHash) {
        return { kind: 'conflict', record }
      }
      if (record.status === 'RUNNING') return { kind: 'in_flight', record }
      return { kind: 'replay', record }
    }

    const { data: inserted, error: insertError } = await this.supabase
      .from('iara_execution_idempotency')
      .insert({
        tenant_id: input.tenantId,
        idempotency_key: input.idempotencyKey,
        tool_key: input.call.toolKey,
        tool_version: input.call.version,
        request_hash: requestHash,
        execution_id: input.executionId,
        status: 'RUNNING',
      })
      .select('*')
      .single()

    if (!insertError && inserted) return { kind: 'claimed', record: mapRecord(inserted as Record<string, unknown>) }

    if (insertError?.code !== '23505') {
      throw new Error(`Idempotency claim failed: ${insertError?.message ?? 'unknown error'}`)
    }

    const { data: raced, error: raceError } = await this.supabase
      .from('iara_execution_idempotency')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .single()

    if (raceError || !raced) throw new Error(`Idempotency race resolution failed: ${raceError?.message ?? 'record unavailable'}`)
    const record = mapRecord(raced as Record<string, unknown>)
    if (record.toolKey !== input.call.toolKey || record.toolVersion !== input.call.version || record.requestHash !== requestHash) {
      return { kind: 'conflict', record }
    }
    return record.status === 'RUNNING' ? { kind: 'in_flight', record } : { kind: 'replay', record }
  }

  async complete(tenantId: string, idempotencyKey: string, result: unknown): Promise<void> {
    const { error } = await this.supabase
      .from('iara_execution_idempotency')
      .update({ status: 'COMPLETED', result, error: null, completed_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', idempotencyKey)
      .eq('status', 'RUNNING')
    if (error) throw new Error(`Idempotency completion failed: ${error.message}`)
  }

  async fail(tenantId: string, idempotencyKey: string, errorMessage: string): Promise<void> {
    const { error } = await this.supabase
      .from('iara_execution_idempotency')
      .update({ status: 'FAILED', error: errorMessage, completed_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('idempotency_key', idempotencyKey)
      .eq('status', 'RUNNING')
    if (error) throw new Error(`Idempotency failure update failed: ${error.message}`)
  }
}
