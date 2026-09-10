export type RevenueAgentContext={conversationId:string;recommendation:string;probability:number;recoveryProbability:number;rationale:string;evidence:Record<string,unknown>}
export type RevenueAgentDraft={available:boolean;provider:string;mode:string;draft:string|null;confidence:number}
function env(name:string){return process.env[name]?.trim()||''}
function safeDraft(value:unknown){
 if(typeof value!=='string')return null
 const text=value.trim()
 if(!text||text.length>4000)return null
 const forbidden=[/\bgarant(o|imos|ido)?\b/i,/\bsem risco\b/i,/\bpreço de R\$/i,/\bR\$\s*\d/i,/\bpagamento\s+(aprovado|confirmado)\b/i,/\bdesconto de\s+\d/i]
 if(forbidden.some(r=>r.test(text)))return null
 return text
}
export async function generateRevenueAgentDraft(ctx:RevenueAgentContext):Promise<RevenueAgentDraft>{
 const key=env('ALTHEA_AI_API_KEY')||env('OPENAI_API_KEY');const endpoint=env('ALTHEA_AI_BASE_URL')||'https://api.openai.com/v1/chat/completions';const model=env('ALTHEA_AI_MODEL')||'gpt-5.6-luna'
 if(!key)return{available:false,provider:'none',mode:'grounded_behavioral_fallback',draft:null,confidence:0}
 const payload={model,temperature:0.2,messages:[
  {role:'system',content:'You are Althea Pay Revenue Agent. Return ONLY JSON in the form {"draft":"..."}. Draft a concise Portuguese-BR customer-facing sales/recovery reply grounded only in supplied CRM evidence. Never invent prices, payment status, policies, customer facts, discounts, guarantees or promises. Never claim an action was executed. If evidence is insufficient, write a cautious clarification request. Keep under 1200 characters.'},
  {role:'user',content:JSON.stringify({conversation_id:ctx.conversationId,recommendation:ctx.recommendation,conversion_probability:ctx.probability,recovery_probability:ctx.recoveryProbability,rationale:ctx.rationale,evidence:ctx.evidence})}],response_format:{type:'json_object'}}
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000)
 try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal:controller.signal,cache:'no-store'});if(!response.ok)return{available:false,provider:'configured_unavailable',mode:'grounded_behavioral_fallback',draft:null,confidence:0};const data=await response.json() as {choices?:Array<{message?:{content?:string}}>};const raw=data.choices?.[0]?.message?.content?.trim()||'';if(!raw)return{available:false,provider:'configured_empty',mode:'grounded_behavioral_fallback',draft:null,confidence:0};let parsed:{draft?:unknown};try{parsed=JSON.parse(raw)}catch{return{available:false,provider:'invalid_json',mode:'grounded_behavioral_fallback',draft:null,confidence:0}}const draft=safeDraft(parsed.draft);if(!draft)return{available:false,provider:'unsafe_or_invalid_output',mode:'grounded_behavioral_fallback',draft:null,confidence:0};const evidenceCompleteness=['customer_360','next_best_action','predictive_scores'].filter(k=>k in ctx.evidence).length/3;return{available:true,provider:'openai_compatible',mode:'grounded_llm_draft_v2',draft,confidence:Number((0.55+0.3*evidenceCompleteness).toFixed(2))}}
 catch{return{available:false,provider:'configured_error',mode:'grounded_behavioral_fallback',draft:null,confidence:0}}
 finally{clearTimeout(timer)}
}
