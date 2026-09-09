import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request:Request){
  const supabase=await createSupabaseServerClient()
  const {data:{user},error}=await supabase.auth.getUser()
  if(error||!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const id=new URL(request.url).searchParams.get('experiment')?.trim()??''
  if(!UUID.test(id))return NextResponse.json({error:'INVALID_EXPERIMENT'},{status:400})
  const {data, error:rpcError}=await supabase.rpc('crm_experiment_report',{p_experiment_id:id})
  if(rpcError)return NextResponse.json({error:rpcError.message},{status:500})
  if(!data)return NextResponse.json({error:'NOT_FOUND'},{status:404})
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}})
}
