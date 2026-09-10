import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
export const dynamic='force-dynamic'
export async function POST(req:Request){
 const supabase=await createSupabaseServerClient(); const {data:{user},error}=await supabase.auth.getUser()
 if(error||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
 const body=await req.json().catch(()=>null) as {experiment_id?:string;variant_id?:string;reason?:string}|null
 if(!body?.experiment_id||!body?.variant_id)return NextResponse.json({error:'INVALID_INPUT'},{status:400})
 const {data,error:rpcError}=await supabase.rpc('crm_experiment_promote_winner',{p_experiment_id:body.experiment_id,p_variant_id:body.variant_id,p_reason:typeof body.reason==='string'?body.reason.slice(0,1000):null})
 if(rpcError)return NextResponse.json({error:'PROMOTION_REJECTED',detail:rpcError.message},{status:409})
 return NextResponse.json(data,{status:200})
}
