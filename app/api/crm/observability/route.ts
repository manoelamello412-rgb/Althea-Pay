import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadOrganizationAccess } from '@/lib/auth/organization-access'
export const dynamic='force-dynamic'
export async function GET(){
 const supabase=await createSupabaseServerClient(); const {data:{user},error}=await supabase.auth.getUser()
 if(error||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
 const {organization_id:organizationId}=await loadOrganizationAccess(supabase)
 const [delivery,automation,predictive]=await Promise.all([
  supabase.from('crm_channel_delivery_events').select('status,occurred_at,channel_account_id,conversation_id,external_message_id').eq('organization_id',organizationId).order('occurred_at',{ascending:false}).limit(100),
  supabase.from('automation_executions').select('id,rule_id,status,attempt_count,max_attempts,next_retry_at,dead_lettered_at,error_message,created_at,completed_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(100),
  supabase.rpc('crm_predictive_evaluation_summary',{p_model_version:'deterministic_behavioral_v1'})
 ])
 if(delivery.error||automation.error||predictive.error)return NextResponse.json({error:'OBSERVABILITY_QUERY_FAILED',detail:delivery.error?.message||automation.error?.message||predictive.error?.message},{status:500})
 const statuses=(delivery.data??[]).reduce<Record<string,number>>((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a},{}); const executions=automation.data??[]
 return NextResponse.json({ok:true,delivery:{total:delivery.data?.length??0,statuses,events:delivery.data??[]},automation:{total:executions.length,failed:executions.filter(x=>x.status==='failed').length,dead_letter:executions.filter(x=>x.status==='dead_letter').length,running:executions.filter(x=>x.status==='running').length,executions},predictive:predictive.data},{headers:{'Cache-Control':'no-store'}})
}
