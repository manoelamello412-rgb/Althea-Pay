import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Score=Record<string,unknown>
type Action=Record<string,unknown>

export async function GET(request:Request){
  const supabase=await createSupabaseServerClient()
  const {data:{user},error:authError}=await supabase.auth.getUser()
  if(authError||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const id=new URL(request.url).searchParams.get('conversation')?.trim()??''
  if(!UUID.test(id))return NextResponse.json({error:'INVALID_CONVERSATION'},{status:400})

  const [{data:next,error:nextError},{data:score,error:scoreError}]=await Promise.all([
    supabase.rpc('crm_next_best_action',{p_conversation_id:id}),
    supabase.rpc('crm_predictive_scores',{p_conversation_id:id}),
  ])
  if(nextError)return NextResponse.json({error:nextError.message},{status:500})
  if(scoreError)return NextResponse.json({error:scoreError.message},{status:500})
  if(!next&&!score)return NextResponse.json({error:'NOT_FOUND'},{status:404})

  const n=(next??{}) as Action
  const s=(score??{}) as Score
  const recommendation=String(n.recommendation??n.action??'monitor')
  const probability=Number(n.probability??s.conversion_probability??0)
  const recovery=Number(s.recovery_probability??0)
  const rationale=String(n.reason??'Recomendação derivada exclusivamente dos sinais reais disponíveis no Customer 360.')
  const mode='grounded_behavioral_v1'

  const payload={
    conversation_id:id,
    recommendation,
    probability,
    recovery_probability:recovery,
    rationale,
    evidence:{next_best_action:n,predictive_scores:s},
    mode,
    human_approval_required:true,
    generated_at:new Date().toISOString(),
  }
  return NextResponse.json(payload,{headers:{'Cache-Control':'no-store'}})
}
