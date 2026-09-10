import type { SupabaseClient } from '@supabase/supabase-js'

export type ForecastMetric = 'revenue' | 'checkout_abandonment' | 'gateway_approval_rate' | 'gateway_latency' | 'gateway_error_rate' | 'churn'
export interface ForecastPoint { timestamp: string; value: number; lowerBound: number; upperBound: number }
export interface ForecastResult { forecastId: string; tenantId: string; metric: ForecastMetric; horizon: number; points: ForecastPoint[]; modelVersion: string; confidence: number; dataQuality: number; evidenceCount: number; drivers: Array<{ metric: string; strength: number }>; limitations: string[] }
interface TelemetryRow { metric: string; observed_value: number | string; observed_at: string }
interface SeriesPoint { t: number; value: number }

const MODEL_VERSION = 'iara-forecast-v1'
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function linearForecast(series: SeriesPoint[], horizon: number): { values: number[]; residualStd: number } {
  if (series.length === 0) return { values: Array.from({ length: horizon }, () => 0), residualStd: 0 }
  if (series.length === 1) return { values: Array.from({ length: horizon }, () => Math.max(0, series[0].value)), residualStd: 0 }
  const xMean = series.reduce((s, p) => s + p.t, 0) / series.length
  const yMean = series.reduce((s, p) => s + p.value, 0) / series.length
  const denom = series.reduce((s, p) => s + (p.t - xMean) ** 2, 0)
  const slope = denom > 0 ? series.reduce((s, p) => s + (p.t - xMean) * (p.value - yMean), 0) / denom : 0
  const intercept = yMean - slope * xMean
  const residuals = series.map((p) => p.value - (intercept + slope * p.t))
  const residualStd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length - 2))
  const lastT = series[series.length - 1].t
  return { values: Array.from({ length: horizon }, (_, i) => Math.max(0, intercept + slope * (lastT + i + 1))), residualStd }
}

export class IaraForecastingEngine {
  constructor(private readonly supabase: SupabaseClient) {}

  async forecast(input: { tenantId: string; metric: ForecastMetric; telemetryMetric: string; horizon: number; windowHours?: number; executionId?: string }): Promise<ForecastResult> {
    const horizon = Math.max(1, Math.min(168, Math.trunc(input.horizon)))
    const windowHours = Math.max(6, Math.min(24 * 90, Math.trunc(input.windowHours ?? 24 * 14)))
    const since = new Date(Date.now() - windowHours * 3600_000).toISOString()
    const { data, error } = await this.supabase.from('iara_operational_telemetry').select('metric,observed_value,observed_at').eq('tenant_id', input.tenantId).eq('metric', input.telemetryMetric).gte('observed_at', since).order('observed_at', { ascending: true }).limit(10000)
    if (error) throw new Error(`forecast_telemetry_query_failed: ${error.message}`)
    const rows = (data ?? []) as TelemetryRow[]
    const series = rows.map((row, index) => ({ t: index, value: Number(row.observed_value) })).filter((p): p is SeriesPoint => finite(p.value))
    if (series.length < 8) throw new Error('forecast_insufficient_history')
    const { values, residualStd } = linearForecast(series, horizon)
    const mean = series.reduce((s, p) => s + p.value, 0) / series.length
    const variance = series.reduce((s, p) => s + (p.value - mean) ** 2, 0) / Math.max(1, series.length - 1)
    const std = Math.sqrt(variance)
    const quality = clamp(Math.min(1, series.length / 200) * (std === 0 ? 0.9 : 1))
    const confidence = clamp(0.45 + quality * 0.45 - Math.min(0.2, Math.abs(residualStd) / Math.max(1, Math.abs(mean)) * 0.2))
    const last = new Date(rows[rows.length - 1].observed_at).getTime()
    const step = series.length > 1 ? Math.max(60_000, (new Date(rows[rows.length - 1].observed_at).getTime() - new Date(rows[0].observed_at).getTime()) / (series.length - 1)) : 3600_000
    const points = values.map((value, index) => { const margin = 1.96 * residualStd * Math.sqrt(1 + (index + 1) / Math.max(1, series.length)); return { timestamp: new Date(last + step * (index + 1)).toISOString(), value, lowerBound: Math.max(0, value - margin), upperBound: value + margin } })
    const forecastId = crypto.randomUUID()
    const result: ForecastResult = { forecastId, tenantId: input.tenantId, metric: input.metric, horizon, points, modelVersion: MODEL_VERSION, confidence, dataQuality: quality, evidenceCount: rows.length, drivers: [], limitations: ['Modelo estatístico de tendência; sazonalidade e causalidade não são inferidas automaticamente.', 'Intervalos são estimativas baseadas em resíduos históricos.'] }
    const { error: persistError } = await this.supabase.from('iara_forecasts').insert({ forecast_id: forecastId, tenant_id: input.tenantId, execution_id: input.executionId ?? null, metric: input.metric, horizon, model_version: MODEL_VERSION, confidence, data_quality: quality, evidence_count: rows.length, points, drivers: [], limitations: result.limitations })
    if (persistError) throw new Error(`forecast_persist_failed: ${persistError.message}`)
    return result
  }
}
