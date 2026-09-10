import type { SupabaseClient } from '@supabase/supabase-js'

export interface ForecastPoint { horizon: number; predicted: number; lower: number; upper: number }
export interface IaraForecast {
  forecastId: string
  tenantId: string
  executionId?: string
  metric: string
  horizon: number
  modelVersion: string
  confidence: number
  dataQuality: number
  evidenceCount: number
  points: ForecastPoint[]
  drivers: Array<{ type: string; value: number; detail: string }>
  limitations: string[]
  createdAt: string
}

interface Options { supabase: SupabaseClient; minimumSamples?: number }

function finite(values: unknown[]): number[] { return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) }
function mean(values: number[]): number { return values.reduce((a, b) => a + b, 0) / values.length }

export class IaraForecastingEngine {
  constructor(private readonly options: Options) {}

  async forecast(input: { tenantId: string; metric: string; horizon?: number; executionId?: string; entityType?: string; entityId?: string }): Promise<IaraForecast | null> {
    const horizon = Math.min(168, Math.max(1, input.horizon ?? 24))
    const minimumSamples = Math.max(8, this.options.minimumSamples ?? 24)
    let query = this.options.supabase
      .from('iara_operational_telemetry')
      .select('observed_value,observed_at')
      .eq('tenant_id', input.tenantId)
      .eq('metric', input.metric)
      .order('observed_at', { ascending: true })
      .limit(500)
    if (input.entityType) query = query.eq('entity_type', input.entityType)
    if (input.entityId) query = query.eq('entity_id', input.entityId)
    const { data, error } = await query
    if (error) throw new Error(`Falha ao consultar série temporal: ${error.message}`)
    const rows = (data ?? []).filter((r) => Number.isFinite(Number(r.observed_value)))
    if (rows.length < minimumSamples) return null

    const values = finite(rows.map((r) => Number(r.observed_value)))
    const n = values.length
    const yMean = mean(values)
    const xMean = (n - 1) / 2
    let numerator = 0
    let denominator = 0
    for (let i = 0; i < n; i += 1) { numerator += (i - xMean) * (values[i] - yMean); denominator += (i - xMean) ** 2 }
    const slope = denominator === 0 ? 0 : numerator / denominator
    const intercept = yMean - slope * xMean
    const residuals = values.map((v, i) => v - (intercept + slope * i))
    const residualStd = Math.sqrt(mean(residuals.map((v) => v * v)))
    const trendStrength = yMean === 0 ? 0 : Math.min(1, Math.abs(slope * n) / Math.max(Math.abs(yMean), 1e-9))
    const dataQuality = Math.min(1, n / 100)
    const confidence = Math.min(0.95, 0.45 + dataQuality * 0.35 + Math.min(0.15, trendStrength * 0.15))
    const points = Array.from({ length: horizon }, (_, i) => {
      const predicted = Math.max(0, intercept + slope * (n + i))
      const margin = 1.96 * Math.max(residualStd, Math.abs(predicted) * 0.02)
      return { horizon: i + 1, predicted, lower: Math.max(0, predicted - margin), upper: predicted + margin }
    })

    const firstAt = rows[0].observed_at
    const lastAt = rows[rows.length - 1].observed_at
    const { data: persisted, error: persistError } = await this.options.supabase
      .from('iara_forecasts')
      .insert({
        tenant_id: input.tenantId,
        execution_id: input.executionId ?? null,
        metric: input.metric,
        horizon,
        model_version: 'TREND_LINEAR_V1',
        confidence,
        data_quality: dataQuality,
        evidence_count: n,
        points,
        drivers: [{ type: 'TREND', value: slope, detail: `Tendência estimada entre ${firstAt} e ${lastAt}.` }],
        limitations: ['Modelo de tendência linear; não captura sazonalidade.', 'Drivers são associativos e não constituem causalidade.', 'Intervalos são preditivos aproximados e exigem backtesting para calibração.'],
      })
      .select('*')
      .single()
    if (persistError) throw new Error(`Falha ao persistir forecast: ${persistError.message}`)
    return {
      forecastId: persisted.forecast_id, tenantId: persisted.tenant_id, executionId: persisted.execution_id ?? undefined,
      metric: persisted.metric, horizon: persisted.horizon, modelVersion: persisted.model_version,
      confidence: Number(persisted.confidence), dataQuality: Number(persisted.data_quality), evidenceCount: persisted.evidence_count,
      points: persisted.points, drivers: persisted.drivers, limitations: persisted.limitations, createdAt: persisted.created_at,
    }
  }
}
