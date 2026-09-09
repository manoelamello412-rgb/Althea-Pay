import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic='force-dynamic'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i
const EXECUTABLE=new Set(['payment_follow_up','sales_follow_up','recovery_follow_up','qualification','upsell_or_post_sale'])
type Payload={ai_draft?:unknown}

export async function POST(request:Request){
 const supabase=await createSupabaseServerClient(); const {data:{user},error:auth}=await supabase.auth.getUser()
 if(auth||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
 const body=await request.json().catch(()=>null) as {action_id?:unknown}|null
 const actionId=typeof body?.action_id==='string'?body.action_id.trim():''
 if(!UUID.test(actionId))return NextResponse.json({error:'INVALID_ACTION'},{status:400})
 const {data:action,error:claimError}=await supabase.rpc('crm_claim_ai_action',{p_action_id:actionId})
 if(claimError||!action)return NextResponse.json({error:'HUMAN_APPROVAL_REQUIRED'},{status:409})
 if(!action.conversation_id||!EXECUTABLE.has(action.action_type)){await supabase.from('crm_ai_actions').update({status:'accepted'}).eq('id',action.id).eq('user_id',user.id).eq('status','executing');return NextResponse.json({error:'ACTION_NOT_EXECUTABLE'},{status:409})}
 const payload=(action.payload??{}) as Payload;const draft=typeof payload.ai_draft==='string'?payload.ai_draft.trim():''
 if(!draft){await supabase.from('crm_ai_actions').update({status:'accepted'}).eq('id',action.id).eq('user_id',user.id).eq('status','executing');return NextResponse.json({error:'AI_DRAFT_MISSING'},{status:409})}
 const clientMessageId=`ai:${action.id}`
 const {data:send,error:sendError}=await supabase.rpc('crm_operator_send_message',{p_conversation_id:action.conversation_id,p_body:draft,p_client_message_id:clientMessageId})
 if(sendError){await supabase.from('crm_ai_actions').update({status:'accepted'}).eq('id',action.id).eq('user_id',user.id).eq('status','executing');return NextResponse.json({error:'AI_ACTION_EXECUTION_FAILED',detail:sendError.message},{status:502})}
 const executedAt=new Date().toISOString()
 const {data:updated,error:updateError}=await supabase.from('crm_ai_actions').update({status:'executed',executed_at:executedAt}).eq('id',action.id).eq('user_id',user.id).eq('status','executing').select('id,status,executed_at').single()
 if(updateError||!updated)return NextResponse.json({error:'AI_ACTION_LEDGER_UPDATE_FAILED'},{status:500})
 return NextResponse.json({ok:true,action:updated,delivery:send},{headers:{'Cache-Control':'no-store'}})
}
