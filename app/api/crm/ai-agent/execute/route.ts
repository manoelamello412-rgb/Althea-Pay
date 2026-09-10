import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
export const dynamic='force-dynamic'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i
const FORBIDDEN=[/\bguaranteed?\b/i,/\bsem\s+risco\b/i,/\bgarantimos?\b/i,/\bdesconto\b/i,/\bdiscount\b/i,/\bstatus\s+do\s+pagamento\b/i]
type Payload={ai_draft?:unknown}
function safeDraft(value:string){const draft=value.trim();return Boolean(draft&&draft.length<=4000&&!FORBIDDEN.some(pattern=>pattern.test(draft)))}
export async function POST(request:Request){
 const supabase=await createSupabaseServerClient();const {data:{user},error:auth}=await supabase.auth.getUser();if(auth||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
 const body=await request.json().catch(()=>null) as {action_id?:unknown}|null;const actionId=typeof body?.action_id==='string'?body.action_id.trim():'';if(!UUID.test(actionId))return NextResponse.json({error:'INVALID_ACTION'},{status:400})
 const {data:action,error:loadError}=await supabase.from('crm_ai_actions').select('id,conversation_id,action_type,payload,status').eq('id',actionId).eq('user_id',user.id).maybeSingle();if(loadError||!action)return NextResponse.json({error:'AI_ACTION_NOT_FOUND'},{status:404})
 if(action.status!=='accepted')return NextResponse.json({error:'HUMAN_APPROVAL_REQUIRED'},{status:409})
 const payload=(action.payload??{}) as Payload;const draft=typeof payload.ai_draft==='string'?payload.ai_draft:'';if(!safeDraft(draft))return NextResponse.json({error:'AI_DRAFT_REJECTED',detail:'Draft failed execution-time safety validation'},{status:422})
 const {data:result,error:executeError}=await supabase.rpc('crm_execute_ai_action',{p_action_id:actionId,p_body:draft.trim()})
 if(executeError)return NextResponse.json({error:'AI_ACTION_EXECUTION_FAILED',detail:executeError.message},{status:409})
 return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})
}
