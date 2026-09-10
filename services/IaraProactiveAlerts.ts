import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnomalyDetection } from './IaraAnomaliesDetector'

export type ProactiveAlertStatus = 'DETECTED' | 'ENRICHED' | 'DISPATCHED' | 'ACKNOWLEDGED' | 'ACTION_PENDING' | 'RESOLVED'
export type AlertSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface IaraProactiveAlert {
  alertId: string
  tenantId: string
  executionId?: string
  sourceType: 'ANOMALY' | 'FORECAST' | 'OPERATIONAL_EVENT'
  sourceId?: string
  category: string
  severity: AlertSeverity
  productId?: string
  funnelId?: string
  gatewayId?: string
  headline: string
  explanation: string
  evidence: Array<Record<string, unknown>>
  estimatedImpact?: number
  impactConfidence?: number
  recommendedActions: Array<{ action: string; risk: 'LOW' | 'MEDIUM' | 'HIGH'; requiresConfirmation: boolean }>
  policyState: 'NOT_ACTIONABLE' | 'RECOMMENDATION_ONLY' | 'ACTION_ALLOWED'
  status: ProactiveAlertStatus
  deduplicationKey: string
  occurrenceCount: number
  firstObservedAt: string
  lastObservedAt: string
  acknowledgedAt?: string
  resolvedAt?: string
  createdAt: string
}

export interface AlertEngineOptions {
  supabase: SupabaseClient
}

function asAlertSeverity(severity: AnomalyDetection['severity']): AlertSeverity {
  return severity
}

function safeImpact(input: { volume?: number; historicalConversion?: number; estimatedEffect?: number; averageTicket?: number }): { value?: number; confidence: number } {
  const values = [input.volume, input.historicalConversion, input.estimatedEffect, input.averageTicket]
  if (values.some((value) => value === undefined || !Number.isFinite(value))) return { confidence: 0 }
  const [volume, conversion, effect, ticket] = values as number[]
  if (volume < 0 || conversion < 0 || effect < 0 || ticket < 0) return { confidence: 0 }
  return { value: volume * conversion * effect * ticket, confidence: 0.7 }
}

export class IaraProactiveAlerts {
  constructor(private readonly options: AlertEngineOptions) {}

  async fromAnomaly(input: {
    anomaly: AnomalyDetection
    executionId?: string
    productId?: string
    funnelId?: string
    gatewayId?: string
    impact?: { volume?: number; historicalConversion?: number; estimatedEffect?: number; averageTicket?: number }
  }): Promise<IaraProactiveAlert | null> {
    const { anomaly } = input
    const impact = safeImpact(input.impact ?? {})
    const deduplicationKey = `anomaly:${anomaly.deduplicationKey}`
    const recommendedActions = this.actionsFor(anomaly)
    const explanation = this.buildExplanation(anomaly)

    const row = {
      tenant_id: anomaly.tenantId,
      execution_id: input.executionId ?? anomaly.executionId ?? null,
      source_type: 'ANOMALY',
      source_id: anomaly.anomalyId,
      category: this.categoryFor(anomaly.metric),
      severity: asAlertSeverity(anomaly.severity),
      product_id: input.productId ?? null,
      funnel_id: input.funnelId ?? null,
      gateway_id: input.gatewayId ?? null,
      headline: `Anomalia detectada em ${anomaly.metric}`,
      explanation,
      evidence: anomaly.evidence,
      estimated_impact: impact.value ?? null,
      impact_confidence: impact.confidence,
      recommended_actions: recommendedActions,
      policy_state: 'RECOMMENDATION_ONLY',
      status: 'DETECTED',
      deduplication_key: deduplicationKey,
      occurrence_count: 1,
      first_observed_at: anomaly.firstObservedAt,
      last_observed_at: anomaly.lastObservedAt,
    }

    const { data, error } = await this.options.supabase
      .from('iara_proactive_alerts')
      .upsert(row, { onConflict: 'tenant_id,deduplication_key', ignoreDuplicates: true })
      .select('*')
      .maybeSingle()

    if (error) throw new Error(`Falha ao persistir alerta: ${error.message}`)
    if (!data) return null

    return {
      alertId: data.alert_id,
      tenantId: data.tenant_id,
      executionId: data.execution_id ?? undefined,
      sourceType: data.source_type,
      sourceId: data.source_id ?? undefined,
      category: data.category,
      severity: data.severity,
      productId: data.product_id ?? undefined,
      funnelId: data.funnel_id ?? undefined,
      gatewayId: data.gateway_id ?? undefined,
      headline: data.headline,
      explanation: data.explanation,
      evidence: data.evidence,
      estimatedImpact: data.estimated_impact === null ? undefined : Number(data.estimated_impact),
      impactConfidence: data.impact_confidence === null ? undefined : Number(data.impact_confidence),
      recommendedActions: data.recommended_actions,
      policyState: data.policy_state,
      status: data.status,
      deduplicationKey: data.deduplication_key,
      occurrenceCount: data.occurrence_count,
      firstObservedAt: data.first_observed_at,
      lastObservedAt: data.last_observed_at,
      acknowledgedAt: data.acknowledged_at ?? undefined,
      resolvedAt: data.resolved_at ?? undefined,
      createdAt: data.created_at,
    }
  }

  private categoryFor(metric: string): string {
    if (/latency|timeout|error|availability/i.test(metric)) return 'GATEWAY_HEALTH'
    if (/conversion|abandon/i.test(metric)) return 'CONVERSION'
    if (/revenue|sales|ticket/i.test(metric)) return 'REVENUE'
    return 'OPERATIONS'
  }

  private actionsFor(anomaly: AnomalyDetection): IaraProactiveAlert['recommendedActions'] {
    if (anomaly.severity === 'CRITICAL' || anomaly.severity === 'HIGH') {
      return [{ action: 'Investigar a causa e avaliar failover operacional autorizado.', risk: 'MEDIUM', requiresConfirmation: true }]
    }
    return [{ action: 'Monitorar a métrica e coletar evidência adicional.', risk: 'LOW', requiresConfirmation: false }]
  }

  private buildExplanation(anomaly: AnomalyDetection): string {
    return `${anomaly.metric} apresentou valor ${anomaly.observedValue}, ${Math.abs(anomaly.deviation).toFixed(2)} desvios-padrão da média histórica da janela. A detecção não estabelece causalidade.`
  }
}
