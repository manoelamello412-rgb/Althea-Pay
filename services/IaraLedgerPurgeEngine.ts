import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export interface PurgeConfig {
  telemetryRetentionDays: number
  chatRetentionDays: number
  webhookRetentionDays: number
  batchLimit: number
}

export interface PurgeReport {
  tenantId: string
  telemetryRowsPurged: number
  chatRowsCompacted: number
  webhookRowsCompacted: number
  spaceCompactedBytes: number
  executionTimeMs: number
  status: 'SUCCESS' | 'PARTIAL_FAIL' | 'BLOCKED'
}

type CompactionResult = {
  rows_compacted: number
  bytes_compacted: number
  first_sequence_id: number | null
  last_sequence_id: number | null
}

const DEFAULT_CONFIG: PurgeConfig = {
  telemetryRetentionDays: 7,
  chatRetentionDays: 90,
  webhookRetentionDays: 90,
  batchLimit: 500,
}

const assertConfig = (config: PurgeConfig): void => {
  if (!Number.isInteger(config.telemetryRetentionDays) || config.telemetryRetentionDays < 1) throw new Error('Invalid telemetry retention.')
  if (!Number.isInteger(config.chatRetentionDays) || config.chatRetentionDays < 1) throw new Error('Invalid chat retention.')
  if (!Number.isInteger(config.webhookRetentionDays) || config.webhookRetentionDays < 1) throw new Error('Invalid webhook retention.')
  if (!Number.isInteger(config.batchLimit) || config.batchLimit < 1 || config.batchLimit > 5000) throw new Error('Invalid maintenance batch limit.')
}

export class IaraLedgerPurgeEngine {
  private readonly config: PurgeConfig

  constructor(customConfig?: Partial<PurgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig }
    assertConfig(this.config)
  }

  public async executeAutomaticMaintenance(tenantId: string): Promise<PurgeReport> {
    const startedAt = Date.now()
    const report: PurgeReport = {
      tenantId,
      telemetryRowsPurged: 0,
      chatRowsCompacted: 0,
      webhookRowsCompacted: 0,
      spaceCompactedBytes: 0,
      executionTimeMs: 0,
      status: 'SUCCESS',
    }

    try {
      const supabase = createSupabaseAdminClient()
      const jobs: Array<Promise<CompactionResult>> = []

      // Behavioral edge telemetry is volatile by policy. It is not treated as
      // a billing ledger and therefore is safely discarded after its retention window.
      jobs.push(this.compact(supabase, tenantId, 'EDGE_BEHAVIOR_TELEMETRY', this.config.telemetryRetentionDays))
      jobs.push(this.compact(supabase, tenantId, 'CHAT_APPEND', this.config.chatRetentionDays))
      jobs.push(this.compact(supabase, tenantId, 'WEBHOOK_SNAPSHOT', this.config.webhookRetentionDays))

      const [telemetry, chat, webhook] = await Promise.all(jobs)
      report.telemetryRowsPurged = telemetry.rows_compacted
      report.chatRowsCompacted = chat.rows_compacted
      report.webhookRowsCompacted = webhook.rows_compacted
      report.spaceCompactedBytes = telemetry.bytes_compacted + chat.bytes_compacted + webhook.bytes_compacted
      return report
    } catch (cause) {
      report.status = this.isMaintenanceConflict(cause) ? 'BLOCKED' : 'PARTIAL_FAIL'
      return report
    } finally {
      report.executionTimeMs = Date.now() - startedAt
    }
  }

  private async compact(
    supabase: ReturnType<typeof createSupabaseAdminClient>,
    tenantId: string,
    eventType: 'EDGE_BEHAVIOR_TELEMETRY' | 'CHAT_APPEND' | 'WEBHOOK_SNAPSHOT',
    retentionDays: number,
  ): Promise<CompactionResult> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.rpc('iara_compact_memory_batch', {
      p_tenant_id: tenantId,
      p_event_type: eventType,
      p_cutoff: cutoff,
      p_batch_limit: this.config.batchLimit,
    })

    if (error) throw new Error(`IARA ledger compaction failed: ${error.message}`)
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row !== 'object') throw new Error('IARA ledger compaction returned an invalid result.')

    return {
      rows_compacted: Number((row as Record<string, unknown>).rows_compacted ?? 0),
      bytes_compacted: Number((row as Record<string, unknown>).bytes_compacted ?? 0),
      first_sequence_id: this.optionalNumber((row as Record<string, unknown>).first_sequence_id),
      last_sequence_id: this.optionalNumber((row as Record<string, unknown>).last_sequence_id),
    }
  }

  private optionalNumber(value: unknown): number | null {
    return value === null || value === undefined ? null : Number(value)
  }

  private isMaintenanceConflict(cause: unknown): boolean {
    return cause instanceof Error && cause.message.toLowerCase().includes('maintenance already running')
  }
}
