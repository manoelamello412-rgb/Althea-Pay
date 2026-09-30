import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateRevenueAgentDraft } from '@/lib/crm/ai/provider'

export const dynamic='force-dynamic'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i
const IDEM=/^[A-Za-z0-9._:-]{8,200}$/
type Json=Record<string,unknown>

function errorStatus(error:{code?:string;message?:string}){
  if(error.code==='42501')return 403
  if(error.code==='P0002'||/NOT_FOUND/i.test(error.message??''))return 404
  if(error.code==='23505')return 409
  return 500
}

function percentage(value:unknown){
  const n=Number(value??0)
  if(!Number.isFinite(n))return 0
  return n>=0&&n<=1?n*100:n
}

async function buildAgent(supabase:Awaited<ReturnType<typeof createServerClient>>,id:string){
  const [
    {data:next,error:nextError},
    {data:score,error:scoreError},
    {data:customer360,error:customerError},
  ]=await Promise.all([
    supabase.rpc('crm_next_best_action',{p_conversation_id:id}),
    supabase.rpc('crm_predictive_scores',{p_conversation_id:id}),
    supabase.rpc('crm_customer_360',{p_conversation_id:id}),
  ])

  if(nextError)throw nextError
  if(scoreError)throw scoreError
  if(customerError)throw customerError
  if(!next&&!score&&!customer360)return null

  const n=(next??{}) as Json
  const s=(score??{}) as Json
  const c=(customer360??{}) as Json
  const base={
    conversation_id:id,
    recommendation:String(n.recommendation??n.action??'monitor'),
    probability:percentage(n.probability??s.conversion_probability),
    recovery_probability:percentage(s.recovery_probability),
    rationale:String(n.reason??'Recomendação derivada exclusivamente dos sinais reais disponíveis no Customer 360.'),
    evidence:{next_best_action:n,predictive_scores:s,customer_360:c},
  }

  const draft=await generateRevenueAgentDraft({
    conversationId:id,
    recommendation:base.recommendation,
    probability:base.probability,
    recoveryProbability:base.recovery_probability,
    rationale:base.rationale,
    evidence:base.evidence,
  })

  return {
    ...base,
    ai_draft:draft.draft,
    ai_provider:draft.provider,
    ai_mode:draft.mode,
    ai_available:draft.available,
    ai_confidence:draft.confidence,
    inference_provenance:draft.inferenceProvenance,
    mode:draft.mode,
    human_approval_required:true,
    generated_at:new Date().toISOString(),
  }
}

export async function GET(request:Request){
  const supabase=await createServerClient()
  const {data:{user},error:authError}=await supabase.auth.getUser()
  if(authError||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})

  const id=new URL(request.url).searchParams.get('conversation')?.trim()??''
  if(!UUID.test(id))return NextResponse.json({error:'INVALID_CONVERSATION'},{status:400})

  try{
    const agent=await buildAgent(supabase,id)
    if(!agent)return NextResponse.json({error:'NOT_FOUND'},{status:404})

    const {data:actions,error:actionsError}=await supabase.rpc('crm_ai_actions_list',{
      p_conversation_id:id,
    })
    if(actionsError){
      return NextResponse.json(
        {error:'AI_ACTION_LEDGER_FAILED',detail:actionsError.message},
        {status:errorStatus(actionsError)},
      )
    }

    return NextResponse.json(
      {...agent,actions:Array.isArray(actions)?actions:[]},
      {headers:{'Cache-Control':'no-store'}},
    )
  }catch(error){
    const e=error as {code?:string;message?:string}
    return NextResponse.json(
      {error:'AI_AGENT_FAILED',detail:e.message??'unknown'},
      {status:errorStatus(e)},
    )
  }
}

export async function POST(request:Request){
  const supabase=await createServerClient()
  const {data:{user},error:authError}=await supabase.auth.getUser()
  if(authError||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})

  const body=await request.json().catch(()=>null) as Json|null
  const id=typeof body?.conversation_id==='string'?body.conversation_id.trim():''
  const decision=typeof body?.decision==='string'?body.decision:'suggested'
  const headerKey=request.headers.get('idempotency-key')?.trim()??''
  const bodyKey=typeof body?.idempotency_key==='string'?body.idempotency_key.trim():''
  const idempotencyKey=headerKey||bodyKey

  if(!UUID.test(id))return NextResponse.json({error:'INVALID_CONVERSATION'},{status:400})
  if(!['suggested','accepted','dismissed'].includes(decision)){
    return NextResponse.json({error:'INVALID_DECISION'},{status:400})
  }
  if(idempotencyKey&&!IDEM.test(idempotencyKey)){
    return NextResponse.json({error:'INVALID_IDEMPOTENCY_KEY'},{status:400})
  }

  try{
    const agent=await buildAgent(supabase,id)
    if(!agent)return NextResponse.json({error:'NOT_FOUND'},{status:404})

    const {data,error}=await supabase.rpc('crm_ai_action_create',{
      p_conversation_id:id,
      p_action_type:agent.recommendation,
      p_score:agent.probability,
      p_rationale:agent.rationale,
      p_status:decision,
      p_idempotency_key:idempotencyKey||null,
      p_payload:{
        mode:agent.mode,
        evidence:agent.evidence,
        source:'crm_ai_agent',
        ai_draft:agent.ai_draft,
        ai_provider:agent.ai_provider,
        ai_available:agent.ai_available,
        ai_confidence:agent.ai_confidence,
        inference_provenance:agent.inference_provenance,
      },
    })

    if(error){
      return NextResponse.json(
        {error:'AI_ACTION_WRITE_FAILED',detail:error.message},
        {status:errorStatus(error)},
      )
    }

    const result=(data??{}) as {action?:Json;replayed?:boolean}
    if(!result.action)return NextResponse.json({error:'AI_ACTION_WRITE_FAILED'},{status:500})

    return NextResponse.json(
      {action:result.action,agent,replayed:result.replayed===true},
      {
        status:result.replayed===true?200:201,
        headers:{'Cache-Control':'no-store'},
      },
    )
  }catch(error){
    const e=error as {code?:string;message?:string}
    return NextResponse.json(
      {error:'AI_AGENT_FAILED',detail:e.message??'unknown'},
      {status:errorStatus(e)},
    )
  }
}
