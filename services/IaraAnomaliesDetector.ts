import type { SupabaseClient } from '@supabase/supabase-js'

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface TelemetryObservation {
  tenantId: string
  metric: string
  observedValue: number
  observedAt: string
  entityType?: string
  entityId?: string
  sourceEventId?: string
  dimensions?: Record<string, unknown>
}

export interface AnomalyDetection {
  anomalyId: string
  tenantId: string
  executionId?: string
  metric: string
  entityType?: string
  entityId?: string
  observedValue: number
  baseline: {
    mean: number
    standardDeviation: number
    sampleCount: number
    windowStart: string
    windowEnd: string
  }
  deviation: number
  detectionMethod: 'Z_SCORE' | 'ROBUST_DEVIATION'
  severity: AnomalySeverity
  confidence: number
  evidence: Array<{ type: string; value: number | string; detail: string }>
  firstObservedAt: string
  lastObservedAt: string
  occurrenceCount: number
  status: 'DETECTED' | 'ACKNOWLEDGED' | 'RESOLVED'
  deduplicationKey: string
  createdAt: string
}

interface DetectorOptions {
  supabase: SupabaseClient
  minimumSamples?: number
  baselineWindowMinutes?: number
  zScoreThreshold?: number
}

export interface BaselineStats {
  mean: number
  standardDeviation: number
  sampleCount: number
}

export function calculateBaseline(values: readonly number[]): BaselineStats {
  if (values.length === 0) return { mean: 0, standardDeviation: 0, sampleCount: 0 }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return { mean, standardDeviation: Math.sqrt(variance), sampleCount: values.length }
}

export function classifyAnomaly(zScore: number, confidence: number): AnomalySeverity {
  const magnitude = Math.abs(zScore)
  if (magnitude >= 5 && confidence >= 0.9) return 'CRITICAL'
  if (magnitude >= 4 && confidence >= 0.8) return 'HIGH'
  if (magnitude >= 3 && confidence >= 0.65) return 'MEDIUM'
  return 'LOW'
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hashKey(parts: readonly string[]): string {
  return parts.join('|').toLowerCase()
}

export class IaraAnomaliesDetector {
  private readonly supabase: SupabaseClient
  private readonly minimumSamples: number
  private readonly baselineWindowMinutes: number
  private readonly zScoreThreshold: number

  constructor(options: DetectorOptions) {
    this.supabase = options.supabase
    this.minimumSamples = Math.max(5, options.minimumSamples ?? 20)
    this.baselineWindowMinutes = Math.max(5, options.baselineWindowMinutes ?? 60)
    this.zScoreThreshold = Math.max(1, options.zScoreThreshold ?? 3)
  }

  async recordTelemetry(observation: TelemetryObservation): Promise<void> {
    if (!observation.tenantId || !observation.metric || !validNumber(observation.observedValue)) {
      throw new Error('Telemetry inválida.')
    }
    const { error } = await this.supabase.from('iara_operational_telemetry').upsert({
      tenant_id: observation.tenantId,
      source_event_id: observation.sourceEventId ?? null,
      metric: observation.metric,
      entity_type: observation.entityType ?? null,
      entity_id: observation.entityId ?? null,
      observed_value: observation.observedValue,
      dimensions: observation.dimensions ?? {},
      observed_at: observation.observedAt,
    }, { onConflict: 'tenant_id,source_event_id', ignoreDuplicates: true })
    if (error) throw new Error(`Falha ao persistir telemetry: ${error.message}`)
  }

  async detect(input: TelemetryObservation & { executionId?: string }): Promise<AnomalyDetection | null> {
    const observedAt = new Date(input.observedAt)
    if (Number.isNaN(observedAt.getTime())) throw new Error('observedAt inválido.')
    const windowStart = new Date(observedAt.getTime() - this.baselineWindowMinutes * 60_000)

    let query = this.supabase
      .from('iara_operational_telemetry')
      .select('observed_value,observed_at')
      .eq('tenant_id', input.tenantId)
      .eq('metric', input.metric)
      .gte('observed_at', windowStart.toISOString())
      .lt('observed_at', observedAt.toISOString())
      .order('observed_at', { ascending: true })

    if (input.entityType) query = query.eq('entity_type', input.entityType)
    if (input.entityId) query = query.eq('entity_id', input.entityId)

    const { data, error } = await query
    if (error) throw new Error(`Falha ao consultar baseline: ${error.message}`)

    const values = (data ?? []).map((row) => Number(row.observed_value)).filter(Number.isFinite)
    if (values.length < this.minimumSamples) return null

    const baseline = calculateBaseline(values)
    if (baseline.standardDeviation === 0) return null

    const zScore = (input.observedValue - baseline.mean) / baseline.standardDeviation
    if (Math.abs(zScore) < this.zScoreThreshold) return null

    const confidence = Math.min(0.99, Math.max(0, 1 - 1 / Math.sqrt(values.length)))
    const severity = classifyAnomaly(zScore, confidence)
    const deduplicationKey = hashKey([
      input.metric,
      input.entityType ?? '',
      input.entityId ?? '',
      severity,
      windowStart.toISOString(),
    ])

    const { data: persisted, error: insertError } = await this.supabase
      .from('iara_anomalies')
      .upsert({
        tenant_id: input.tenantId,
        execution_id: input.executionId ?? null,
        metric: input.metric,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        observed_value: input.observedValue,
        baseline_mean: baseline.mean,
        baseline_stddev: baseline.standardDeviation,
        baseline_sample_count: baseline.sampleCount,
        baseline_window_start: windowStart.toISOString(),
        baseline_window_end: observedAt.toISOString(),
        deviation: zScore,
        detection_method: 'Z_SCORE',
        severity,
        confidence,
        evidence: [
          { type: 'BASELINE', value: baseline.mean, detail: 'Média da janela histórica.' },
          { type: 'STANDARD_DEVIATION', value: baseline.standardDeviation, detail: 'Desvio padrão da janela histórica.' },
          { type: 'OBSERVED', value: input.observedValue, detail: 'Valor observado fora do comportamento esperado.' },
        ],
        first_observed_at: observedAt.toISOString(),
        last_observed_at: observedAt.toISOString(),
        occurrence_count: 1,
        status: 'DETECTED',
        deduplication_key: deduplicationKey,
      }, { onConflict: 'tenant_id,deduplication_key', ignoreDuplicates: true })
      .select('*')
      .maybeSingle()

    if (insertError) throw new Error(`Falha ao persistir anomalia: ${insertError.message}`)
    if (!persisted) return null

    return {
      anomalyId: persisted.anomaly_id,
      tenantId: persisted.tenant_id,
      executionId: persisted.execution_id ?? undefined,
      metric: persisted.metric,
      entityType: persisted.entity_type ?? undefined,
      entityId: persisted.entity_id ?? undefined,
      observedValue: Number(persisted.observed_value),
      baseline: {
        mean: Number(persisted.baseline_mean),
        standardDeviation: Number(persisted.baseline_stddev),
        sampleCount: persisted.baseline_sample_count,
        windowStart: persisted.baseline_window_start,
        windowEnd: persisted.baseline_window_end,
      },
      deviation: Number(persisted.deviation),
      detectionMethod: persisted.detection_method,
      severity: persisted.severity,
      confidence: Number(persisted.confidence),
      evidence: persisted.evidence,
      firstObservedAt: persisted.first_observed_at,
      lastObservedAt: persisted.last_observed_at,
      occurrenceCount: persisted.occurrence_count,
      status: persisted.status,
      deduplicationKey: persisted.deduplication_key,
      createdAt: persisted.created_at,
    }
  }
}
