import type { SupabaseClient } from '@supabase/supabase-js'

export interface CausalCandidate { metric: string; effect: number; temporalAlignment: number; evidenceCount: number; conclusion: 'SUPPORTED_ASSOCIATION' | 'INSUFFICIENT_EVIDENCE' }
export interface IaraCausalDiagnosis {
  diagnosisId: string; tenantId: string; executionId?: string; metric: string; observedEffect: number
  candidateCauses: CausalCandidate[]; confounders: string[]; counterfactual: string; causalConclusion: string
  confidence: number; evidenceCoverage: number; recommendedActions: Array<{ action: string; requiresConfirmation: boolean }>
  limitations: string[]; createdAt: string
}

interface Options { supabase: SupabaseClient; lookbackMinutes?: number }

function avg(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0 }
function finite(values: unknown[]): number[] { return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) }

export class IaraCausalityEngine {
  constructor(private readonly options: Options) {}

  async diagnose(input: { tenantId: string; metric: string; observedEffect: number; executionId?: string; candidateMetrics?: string[] }): Promise<IaraCausalDiagnosis> {
    if (!input.tenantId || !input.metric || !Number.isFinite(input.observedEffect)) throw new Error('Contexto causal inválido.')
    const lookback = Math.min(24 * 60, Math.max(15, this.options.lookbackMinutes ?? 180))
    const since = new Date(Date.now() - lookback * 60_000).toISOString()
    const metrics = [...new Set((input.candidateMetrics ?? []).filter((m) => m && m !== input.metric))].slice(0, 10)

    const candidates: CausalCandidate[] = []
    for (const metric of metrics) {
      const { data, error } = await this.options.supabase
        .from('iara_operational_telemetry')
        .select('observed_value,observed_at')
        .eq('tenant_id', input.tenantId)
        .eq('metric', metric)
        .gte('observed_at', since)
        .order('observed_at', { ascending: true })
        .limit(300)
      if (error) throw new Error(`Falha ao consultar evidência causal: ${error.message}`)
      const values = finite((data ?? []).map((r) => Number(r.observed_value)))
      if (values.length < 8) {
        candidates.push({ metric, effect: 0, temporalAlignment: 0, evidenceCount: values.length, conclusion: 'INSUFFICIENT_EVIDENCE' })
        continue
      }
      const split = Math.max(1, Math.floor(values.length / 2))
      const before = avg(values.slice(0, split))
      const after = avg(values.slice(split))
      const effect = after - before
      const temporalAlignment = Math.min(1, Math.abs(effect) / Math.max(Math.abs(before), 1e-9))
      candidates.push({ metric, effect, temporalAlignment, evidenceCount: values.length, conclusion: temporalAlignment >= 0.2 ? 'SUPPORTED_ASSOCIATION' : 'INSUFFICIENT_EVIDENCE' })
    }

    const supported = candidates.filter((c) => c.conclusion === 'SUPPORTED_ASSOCIATION')
    const evidenceCoverage = Math.min(1, supported.length / Math.max(1, candidates.length))
    const confidence = candidates.length === 0 ? 0 : Math.min(0.8, evidenceCoverage * 0.65 + Math.min(0.15, candidates.reduce((s, c) => s + Math.min(c.evidenceCount, 100), 0) / 1000))
    const causalConclusion = supported.length
      ? 'Há evidência temporal compatível com associação; causalidade não foi estabelecida sem desenho contrafactual/controlado.'
      : 'Não há evidência suficiente para atribuir causa ao efeito observado.'

    const row = {
      tenant_id: input.tenantId, execution_id: input.executionId ?? null, metric: input.metric, observed_effect: input.observedEffect,
      candidate_causes: candidates, confounders: ['Sazonalidade, tráfego, composição de tráfego e alterações simultâneas podem confundir a associação.'],
      counterfactual: 'Contrafactual não identificado: seria necessário um controle válido ou desenho quase-experimental para estimar o efeito causal.',
      causal_conclusion: causalConclusion, confidence, evidence_coverage: evidenceCoverage,
      recommended_actions: supported.length ? [{ action: 'Investigar a associação com dados segmentados e, se aplicável, executar experimento controlado.', requiresConfirmation: true }] : [],
      limitations: ['Associação temporal não implica causalidade.', 'A análise não substitui experimento, controle ou método causal validado.', 'Nenhuma ação financeira é executada por este diagnóstico.'],
    }
    const { data, error } = await this.options.supabase.from('iara_causal_diagnoses').insert(row).select('*').single()
    if (error) throw new Error(`Falha ao persistir diagnóstico causal: ${error.message}`)
    return {
      diagnosisId: data.diagnosis_id, tenantId: data.tenant_id, executionId: data.execution_id ?? undefined, metric: data.metric,
      observedEffect: Number(data.observed_effect), candidateCauses: data.candidate_causes, confounders: data.confounders,
      counterfactual: data.counterfactual, causalConclusion: data.causal_conclusion, confidence: Number(data.confidence),
      evidenceCoverage: Number(data.evidence_coverage), recommendedActions: data.recommended_actions, limitations: data.limitations, createdAt: data.created_at,
    }
  }
}
