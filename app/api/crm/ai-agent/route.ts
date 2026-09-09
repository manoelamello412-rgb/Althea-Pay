import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { generateRevenueAgentDraft } from '@/lib/crm/ai/provider'

export const dynamic='force-dynamic'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i
type Json=Record<string,unknown>

async function buildAgent(supabase:Awaited<ReturnType<typeof createSupabaseServerClient>>,id:string){
  const [{data:next,error:nextError},{data:score,error:scoreError},{data:customer360,error:customerError}]=await Promise.all([
    supabase.rpc('crm_next_best_action',{p_conversation_id:id}),
    supabase.rpc('crm_predictive_scores',{p_conversation_id:id}),
    supabase.rpc('crm_customer_360',{p_conversation_id:id}),
  ])
  if(nextError)throw new Error(nextError.message)
  if(scoreError)throw new Error(scoreError.message)
  if(customerError)throw new Error(customerError.message)
  if(!next&&!score&&!customer360)return null
  const n=(next??{}) as Json; const s=(score??{}) as Json; const c=(customer360??{}) as Json
  const base={
    conversation_id:id,
    recommendation:String(n.recommendation??n.action??'monitor'),
    probability:Number(n.probability??s.conversion_probability??0),
    recovery_probability:Number(s.recovery_probability??0),
    rationale:String(n.reason??'Recomendação derivada exclusivamente dos sinais reais disponíveis no Customer 360.'),
    evidence:{next_best_action:n,predictive_scores:s,customer_360:c},
  }
  const draft=await generateRevenueAgentDraft({conversationId:id,recommendation:base.recommendation,probability:base.probability,recoveryProbability:base.recovery_probability,rationale:base.rationale,evidence:base.evidence})
  return {...base,ai_draft:draft.draft,ai_provider:draft.provider,ai_mode:draft.mode,ai_available:draft.available,ai_confidence:draft.confidence,mode:draft.available?'grounded_llm_draft_v1':'grounded_behavioral_v1',human_approval_required:true,generated_at:new Date().toISOString()}
}

export async function GET(request:Request){
  const supabase=await createSupabaseServerClient(); const {data:{user},error:authError}=await supabase.auth.getUser()
  if(authError||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const id=new URL(request.url).searchParams.get('conversation')?.trim()??''; if(!UUID.test(id))return NextResponse.json({error:'INVALID_CONVERSATION'},{status:400})
  try{const agent=await buildAgent(supabase,id);if(!agent)return NextResponse.json({error:'NOT_FOUND'},{status:404});const {data:actions,error}=await supabase.from('crm_ai_actions').select('id,action_type,score,rationale,status,payload,created_at,executed_at').eq('conversation_id',id).eq('user_id',user.id).order('created_at',{ascending:false}).limit(20);if(error)return NextResponse.json({error:'AI_ACTION_LEDGER_FAILED'},{status:500});return NextResponse.json({...agent,actions:actions??[]},{headers:{'Cache-Control':'no-store'}})}catch(error){return NextResponse.json({error:'AI_AGENT_FAILED',detail:error instanceof Error?error.message:'unknown'},{status:500})}
}

export async function POST(request:Request){
  const supabase=await createSupabaseServerClient(); const {data:{user},error:authError}=await supabase.auth.getUser(); if(authError||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const body=await request.json().catch(()=>null) as Json|null; const id=typeof body?.conversation_id==='string'?body.conversation_id.trim():''; const decision=typeof body?.decision==='string'?body.decision:'suggested'
  if(!UUID.test(id))return NextResponse.json({error:'INVALID_CONVERSATION'},{status:400}); if(!['suggested','accepted','dismissed'].includes(decision))return NextResponse.json({error:'INVALID_DECISION'},{status:400})
  try{const agent=await buildAgent(supabase,id);if(!agent)return NextResponse.json({error:'NOT_FOUND'},{status:404});const {data:row,error}=await supabase.from('crm_ai_actions').insert({user_id:user.id,conversation_id:id,action_type:agent.recommendation,score:agent.probability,rationale:agent.rationale,status:decision,payload:{mode:agent.mode,evidence:agent.evidence,source:'crm_ai_agent',ai_draft:agent.ai_draft,ai_provider:agent.ai_provider,ai_available:agent.ai_available,ai_confidence:agent.ai_confidence}}).select('id,action_type,score,rationale,status,payload,created_at,executed_at').single();if(error)return NextResponse.json({error:'AI_ACTION_WRITE_FAILED',detail:error.message},{status:500});return NextResponse.json({action:row,agent},{status:201,headers:{'Cache-Control':'no-store'}})}catch(error){return NextResponse.json({error:'AI_AGENT_FAILED',detail:error instanceof Error?error.message:'unknown'},{status:500})}
}
