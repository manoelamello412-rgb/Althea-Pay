export type RevenueAgentContext={
  conversationId:string
  recommendation:string
  probability:number
  recoveryProbability:number
  rationale:string
  evidence:Record<string,unknown>
}

export type RevenueAgentDraft={
  available:boolean
  provider:string
  mode:string
  draft:string|null
  confidence:number
}

function env(name:string){return process.env[name]?.trim()||''}

export async function generateRevenueAgentDraft(ctx:RevenueAgentContext):Promise<RevenueAgentDraft>{
  const key=env('ALTHEA_AI_API_KEY')||env('OPENAI_API_KEY')
  const endpoint=env('ALTHEA_AI_BASE_URL')||'https://api.openai.com/v1/chat/completions'
  const model=env('ALTHEA_AI_MODEL')||'gpt-5-mini'
  if(!key)return {available:false,provider:'none',mode:'grounded_behavioral_fallback',draft:null,confidence:0}

  const payload={
    model,
    temperature:0.2,
    messages:[
      {role:'system',content:'You are Althea Pay Revenue Agent. Draft concise Portuguese-BR customer-facing sales/recovery replies grounded only in the supplied CRM evidence. Never invent prices, payment status, policies, customer facts, or promises. If evidence is insufficient, say so. Do not execute actions; produce text only.'},
      {role:'user',content:JSON.stringify({conversation_id:ctx.conversationId,recommendation:ctx.recommendation,conversion_probability:ctx.probability,recovery_probability:ctx.recoveryProbability,rationale:ctx.rationale,evidence:ctx.evidence})}
    ],
    response_format:{type:'json_object'}
  }
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),8000)
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal:controller.signal,cache:'no-store'})
    if(!response.ok)return {available:false,provider:'configured_unavailable',mode:'grounded_behavioral_fallback',draft:null,confidence:0}
    const data=await response.json() as {choices?:Array<{message?:{content?:string}}>}
    const raw=data.choices?.[0]?.message?.content?.trim()||''
    if(!raw)return {available:false,provider:'configured_empty',mode:'grounded_behavioral_fallback',draft:null,confidence:0}
    let draft=raw
    try{
      const parsed=JSON.parse(raw) as {draft?:unknown}
      if(typeof parsed.draft==='string')draft=parsed.draft.trim()
    }catch{}
    if(!draft)return {available:false,provider:'configured_empty',mode:'grounded_behavioral_fallback',draft:null,confidence:0}
    return {available:true,provider:'openai_compatible',mode:'grounded_llm_draft_v1',draft,confidence:0.7}
  }catch{
    return {available:false,provider:'configured_error',mode:'grounded_behavioral_fallback',draft:null,confidence:0}
  }finally{clearTimeout(timer)}
}
