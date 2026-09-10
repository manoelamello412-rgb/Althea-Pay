import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const IARA_QUEUE_TYPES = [
  'TELEMETRY_PROCESS',
  'CRM_INJECTION',
  'FINANCIAL_PIX_RETRY',
] as const

export type JobQueueType = (typeof IARA_QUEUE_TYPES)[number]

export interface QueueJob<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  tenantId: string
  type: JobQueueType
  payload: TPayload
  attemptsMade: number
  maxAttempts: number
  enqueuedAt: string
}

export interface QueueReceipt {
  messageId: number
  jobId: string
  tenantId: string
  type: JobQueueType
  attemptsMade: number
  maxAttempts: number
  payload: Record<string, unknown>
}

export interface QueueExecutionContext {
  workerId: string
  messageId: number
  jobId: string
  tenantId: string
  type: JobQueueType
  attempt: number
  signal: AbortSignal
}

export interface QueueExecutionResult {
  status: 'COMPLETED' | 'RETRY' | 'DEAD_LETTER'
  errorCode?: string
  errorMessage?: string
}

export interface QueueOrchestratorConfig {
  visibilityTimeoutSeconds: number
  maxAttempts: number
  maxBatchSize: number
  retryBaseDelaySeconds: number
  retryMaxDelaySeconds: number
}

export interface QueueWorkerHandler {
  execute: (
    job: QueueJob,
    context: QueueExecutionContext,
  ) => Promise<void>
}

interface ClaimedQueueRow {
  msg_id: number
  read_ct: number
  enqueued_at: string
  vt: string
  message: unknown
}

interface EnqueueRpcRow {
  job_id: string
  message_id: number
  duplicate: boolean
}

const DEFAULT_CONFIG: QueueOrchestratorConfig = {
  visibilityTimeoutSeconds: 60,
  maxAttempts: 5,
  maxBatchSize: 25,
  retryBaseDelaySeconds: 1,
  retryMaxDelaySeconds: 300,
}

const QUEUE_NAMES: Record<JobQueueType, string> = {
  TELEMETRY_PROCESS: 'iara-telemetry-process',
  CRM_INJECTION: 'iara-crm-injection',
  FINANCIAL_PIX_RETRY: 'iara-financial-pix-retry',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const assertUuid = (value: string, field: string): void => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid ${field}.`)
  }
}

const assertPositiveInteger = (value: number, field: string): void => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${field}.`)
}

const parseQueueRow = (row: ClaimedQueueRow): QueueReceipt => {
  if (!Number.isSafeInteger(row.msg_id) || !isRecord(row.message)) {
    throw new Error('Invalid queue message.')
  }

  const message = row.message
  const jobId = typeof message.jobId === 'string' ? message.jobId : ''
  const tenantId = typeof message.tenantId === 'string' ? message.tenantId : ''
  const type = typeof message.type === 'string' ? message.type : ''
  const attemptsMade = typeof message.attemptsMade === 'number' ? message.attemptsMade : -1
  const maxAttempts = typeof message.maxAttempts === 'number' ? message.maxAttempts : -1
  const payload = isRecord(message.payload) ? message.payload : null

  if (!jobId || !tenantId || !IARA_QUEUE_TYPES.includes(type as JobQueueType)) {
    throw new Error('Queue message identity is invalid.')
  }
  assertUuid(jobId, 'jobId')
  assertUuid(tenantId, 'tenantId')
  if (!Number.isInteger(attemptsMade) || attemptsMade < 0 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || !payload) {
    throw new Error('Queue message metadata is invalid.')
  }

  return {
    messageId: row.msg_id,
    jobId,
    tenantId,
    type: type as JobQueueType,
    attemptsMade,
    maxAttempts,
    payload,
  }
}

export class IaraQueueOrchestrator {
  private readonly supabase = createSupabaseAdminClient()
  private readonly config: QueueOrchestratorConfig

  public constructor(customConfig?: Partial<QueueOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig }
    assertPositiveInteger(this.config.visibilityTimeoutSeconds, 'visibilityTimeoutSeconds')
    assertPositiveInteger(this.config.maxAttempts, 'maxAttempts')
    if (this.config.maxBatchSize < 1 || this.config.maxBatchSize > 100) throw new Error('Invalid maxBatchSize.')
    assertPositiveInteger(this.config.retryBaseDelaySeconds, 'retryBaseDelaySeconds')
    assertPositiveInteger(this.config.retryMaxDelaySeconds, 'retryMaxDelaySeconds')
    if (this.config.retryBaseDelaySeconds > this.config.retryMaxDelaySeconds) throw new Error('Invalid retry delay configuration.')
  }

  public async addJobToQueue<TPayload extends Record<string, unknown>>(
    tenantId: string,
    type: JobQueueType,
    payload: TPayload,
    options?: { idempotencyKey?: string; maxAttempts?: number },
  ): Promise<{ jobId: string; messageId: number; duplicate: boolean }> {
    assertUuid(tenantId, 'tenantId')
    if (!IARA_QUEUE_TYPES.includes(type)) throw new Error('Unsupported queue type.')

    const idempotencyKey = options?.idempotencyKey ?? randomUUID()
    assertUuid(idempotencyKey, 'idempotencyKey')
    const maxAttempts = options?.maxAttempts ?? this.config.maxAttempts
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('Invalid maxAttempts.')

    const { data, error } = await this.supabase.rpc('iara_enqueue_job', {
      p_tenant_id: tenantId,
      p_job_id: randomUUID(),
      p_idempotency_key: idempotencyKey,
      p_queue_type: type,
      p_payload: payload,
      p_max_attempts: maxAttempts,
      p_queue_name: QUEUE_NAMES[type],
    })

    if (error) throw new Error(`IARA queue enqueue failed: ${error.message}`)
    const row = (Array.isArray(data) ? data[0] : data) as EnqueueRpcRow | null
    if (!row || typeof row.job_id !== 'string' || !Number.isSafeInteger(Number(row.message_id))) {
      throw new Error('IARA queue enqueue returned an invalid result.')
    }

    return {
      jobId: row.job_id,
      messageId: Number(row.message_id),
      duplicate: Boolean(row.duplicate),
    }
  }

  public async processBatch(
    type: JobQueueType,
    handler: QueueWorkerHandler,
    options?: { batchSize?: number; workerId?: string; signal?: AbortSignal },
  ): Promise<{ claimed: number; completed: number; retried: number; deadLettered: number }> {
    const batchSize = options?.batchSize ?? this.config.maxBatchSize
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > this.config.maxBatchSize) throw new Error('Invalid batchSize.')

    const signal = options?.signal ?? new AbortController().signal
    const workerId = options?.workerId ?? randomUUID()
    const queueName = QUEUE_NAMES[type]

    const { data, error } = await this.supabase.rpc('iara_claim_queue_jobs', {
      p_queue_name: queueName,
      p_visibility_timeout_seconds: this.config.visibilityTimeoutSeconds,
      p_batch_size: batchSize,
    })
    if (error) throw new Error(`IARA queue claim failed: ${error.message}`)

    const rows = Array.isArray(data) ? (data as ClaimedQueueRow[]) : []
    const counters = { claimed: 0, completed: 0, retried: 0, deadLettered: 0 }

    for (const row of rows) {
      if (signal.aborted) break
      counters.claimed += 1
      const receipt = parseQueueRow(row)
      const job: QueueJob = {
        id: receipt.jobId,
        tenantId: receipt.tenantId,
        type: receipt.type,
        payload: receipt.payload,
        attemptsMade: receipt.attemptsMade,
        maxAttempts: receipt.maxAttempts,
        enqueuedAt: row.enqueued_at,
      }

      try {
        await handler.execute(job, {
          workerId,
          messageId: receipt.messageId,
          jobId: receipt.jobId,
          tenantId: receipt.tenantId,
          type: receipt.type,
          attempt: receipt.attemptsMade + 1,
          signal,
        })

        const { error: completeError } = await this.supabase.rpc('iara_complete_queue_job', {
          p_queue_name: queueName,
          p_message_id: receipt.messageId,
          p_job_id: receipt.jobId,
        })
        if (completeError) throw new Error(`IARA queue completion failed: ${completeError.message}`)
        counters.completed += 1
      } catch (cause) {
        const errorMessage = cause instanceof Error ? cause.message : 'Unknown queue worker failure.'
        const nextAttempt = receipt.attemptsMade + 1
        const isFinalAttempt = nextAttempt >= receipt.maxAttempts

        if (isFinalAttempt) {
          const { error: dlqError } = await this.supabase.rpc('iara_dead_letter_queue_job', {
            p_queue_name: queueName,
            p_message_id: receipt.messageId,
            p_job_id: receipt.jobId,
            p_error_code: 'WORKER_FAILED_MAX_ATTEMPTS',
            p_error_message: errorMessage.slice(0, 1000),
          })
          if (dlqError) throw new Error(`IARA DLQ persistence failed: ${dlqError.message}`)
          counters.deadLettered += 1
        } else {
          const delaySeconds = Math.min(
            this.config.retryMaxDelaySeconds,
            this.config.retryBaseDelaySeconds * 2 ** Math.max(0, nextAttempt - 1),
          )
          const { error: retryError } = await this.supabase.rpc('iara_retry_queue_job', {
            p_queue_name: queueName,
            p_message_id: receipt.messageId,
            p_job_id: receipt.jobId,
            p_next_attempt: nextAttempt,
            p_delay_seconds: delaySeconds,
            p_error_code: 'WORKER_RETRYABLE_FAILURE',
            p_error_message: errorMessage.slice(0, 1000),
          })
          if (retryError) throw new Error(`IARA queue retry failed: ${retryError.message}`)
          counters.retried += 1
        }
      }
    }

    return counters
  }
}
