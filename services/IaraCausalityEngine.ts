import type { SupabaseClient } from '@supabase/supabase-js'

export interface CausalCandidate { cause: string; effect: string; lagMinutes: number; effectSize: number; associationStrength: number; temporalPrecedence: boolean; evidenceCount: number; conclusion: 'ASSOCIATION_ONLY' | 'QUASI_CAUSAL_CANDIDATE' }
export interface CausalDiagnosis { diagnosisId: string; executionId?: string; tenantId: string; metric: string; observedEffect: number; candidateCauses: CausalCandidate[]; confounders: string[]; counterfactual: string; causalConclusion: 'SUPPORTED' | 'INSUFFICIENT_EVIDENCE' | 'CONTRADICTED'; confidence: number; evidenceCoverage: number; recommendedActions: string[]; limitations: string[] }
interface Observation { metric: string; value: number; observedAt: number }
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v))

function correlation(a:Observation[],b:Observation[]):{r:number,n:number}|null{
  const pairs:{x:number;y:number}[]=[]
  for(const left of a){let best:Observation|undefined;let bestDelta=Infinity;for(const right of b){const delta=Math.abs(left.observedAt-right.observedAt);if(delta<bestDelta){best=right;bestDelta=delta}}if(best&&bestDelta<=15*60_000)pairs.push({x:left.value,y:best.value})}
  if(pairs.length<8)return null
  const xm=pairs.reduce((s,p)=>s+p.x,0)/pairs.length,ym=pairs.reduce((s,p)=>s+p.y,0)/pairs.length
  const num=pairs.reduce((s,p)=>s+(p.x-xm)*(p.y-ym),0),dx=Math.sqrt(pairs.reduce((s,p)=>s+(p.x-xm)**2,0)),dy=Math.sqrt(pairs.reduce((s,p)=>s+(p.y-ym)**2,0))
  return dx===0||dy===0?{r:0,n:pairs.length}:{r:num/(dx*dy),n:pairs.length}
}

export class IaraCausalityEngine{
 constructor(private readonly supabase:SupabaseClient){}
 async diagnose(input:{tenantId:string;effectMetric:string;candidateMetrics:string[];windowHours?:number;executionId?:string}):Promise<CausalDiagnosis>{
  const hours=Math.max(1,Math.min(24*30,Math.trunc(input.windowHours??24)))
  const since=new Date(Date.now()-hours*3600_000).toISOString()
  const metrics=[input.effectMetric,...input.candidateMetrics].filter((v,i,a)=>v.trim()&&a.indexOf(v)===i)
  const {data,error}=await this.supabase.from('iara_operational_telemetry').select('metric,observed_value,observed_at').eq('tenant_id',input.tenantId).in('metric',metrics).gte('observed_at',since).order('observed_at',{ascending:true}).limit(20000)
  if(error)throw new Error(`causality_telemetry_query_failed: ${error.message}`)
  const grouped=new Map<string,Observation[]>()
  for(const row of (data??[]) as Array<{metric:string;observed_value:number|string;observed_at:string}>){const value=Number(row.observed_value);if(!Number.isFinite(value))continue;const list=grouped.get(row.metric)??[];list.push({metric:row.metric,value,observedAt:new Date(row.observed_at).getTime()});grouped.set(row.metric,list)}
  const effectSeries=grouped.get(input.effectMetric)??[]
  if(effectSeries.length<8)throw new Error('causality_insufficient_effect_history')
  const baselineCount=Math.max(1,Math.floor(effectSeries.length*.25)),baseline=effectSeries.slice(0,baselineCount).reduce((s,o)=>s+o.value,0)/baselineCount,recent=effectSeries.slice(-baselineCount).reduce((s,o)=>s+o.value,0)/baselineCount,observedEffect=recent-baseline
  const candidateCauses:CausalCandidate[]=[]
  for(const metric of input.candidateMetrics){const series=grouped.get(metric)??[];const stats=correlation(series,effectSeries);if(!stats)continue;const causeStart=series.length?series[0].observedAt:0,effectStart=effectSeries.length?effectSeries[0].observedAt:0;const temporalPrecedence=causeStart<=effectStart;const strength=Math.abs(stats.r);candidateCauses.push({cause:metric,effect:input.effectMetric,lagMinutes:0,effectSize:observedEffect,associationStrength:strength,temporalPrecedence,evidenceCount:stats.n,conclusion:temporalPrecedence&&strength>=.7&&stats.n>=20?'QUASI_CAUSAL_CANDIDATE':'ASSOCIATION_ONLY'})}
  candidateCauses.sort((a,b)=>b.associationStrength-a.associationStrength)
  const strong=candidateCauses.filter(c=>c.conclusion==='QUASI_CAUSAL_CANDIDATE')
  const evidenceCoverage=clamp(candidateCauses.reduce((s,c)=>s+c.evidenceCount,0)/Math.max(1,effectSeries.length*input.candidateMetrics.length))
  const confidence=clamp((strong.length?0.55:0.2)+evidenceCoverage*.35+(candidateCauses[0]?.associationStrength??0)*.1)
  const diagnosisId=crypto.randomUUID()
  const diagnosis:CausalDiagnosis={diagnosisId,executionId:input.executionId,tenantId:input.tenantId,metric:input.effectMetric,observedEffect,candidateCauses,confounders:['Observações observacionais não controlam automaticamente sazonalidade, campanhas, mix de tráfego ou mudanças simultâneas.'],counterfactual:'Sem desenho experimental ou grupo de controle identificável, o contrafactual permanece não identificado.',causalConclusion:strong.length&&confidence>=.75?'SUPPORTED':'INSUFFICIENT_EVIDENCE',confidence,evidenceCoverage,recommendedActions:strong.length?[`Investigar ${strong[0].cause} como candidato prioritário e validar com experimento/controle.`]:['Não executar mudança irreversível com base nesta associação; coletar controles e evidência temporal adicional.'],limitations:['Correlação temporal não é prova de causalidade.','Nenhuma ação operacional é executada por este diagnóstico.']}
  const {error:persistError}=await this.supabase.from('iara_causal_diagnoses').insert({diagnosis_id:diagnosisId,tenant_id:input.tenantId,execution_id:input.executionId??null,metric:input.effectMetric,observed_effect:observedEffect,candidate_causes:candidateCauses,confounders:diagnosis.confounders,counterfactual:diagnosis.counterfactual,causal_conclusion:diagnosis.causalConclusion,confidence,evidence_coverage:evidenceCoverage,recommended_actions:diagnosis.recommendedActions,limitations:diagnosis.limitations})
  if(persistError)throw new Error(`causality_persist_failed: ${persistError.message}`)
  return diagnosis
 }
}
