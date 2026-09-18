import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { executePaymentIntent } from '@/lib/payment-os/executor'
import { PaymentOsError } from '@/lib/payment-os/types'

const bodySchema=z.object({organizationId:z.string().uuid(),routingContext:z.object({cardBrand:z.string().optional(),installments:z.number().int().min(1).max(99).optional(),country:z.string().length(2).optional()}).optional()})

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'UNAUTHENTICATED',message:'Authentication required.'},{status:401})
  const body=bodySchema.parse(await request.json());const {data:member,error:memberError}=await supabase.from('organization_members').select('organization_id').eq('organization_id',body.organizationId).eq('user_id',user.id).maybeSingle();if(memberError)throw memberError;if(!member)return NextResponse.json({error:'FORBIDDEN',message:'You are not a member of this organization.'},{status:403})
  const {id}=await params;const result=await executePaymentIntent({db:supabase,organizationId:body.organizationId,intentId:id,routingContext:body.routingContext});return NextResponse.json(result,{status:result.status==='paid'||result.status==='authorized'?200:202})
 }catch(error){if(error instanceof z.ZodError)return NextResponse.json({error:'INVALID_REQUEST',details:error.flatten()},{status:400});if(error instanceof PaymentOsError){const status=error.code==='INTENT_NOT_FOUND'?404:error.code==='IDEMPOTENCY_IN_PROGRESS'?409:400;return NextResponse.json({error:error.code,message:error.message,details:error.details},{status})}return NextResponse.json({error:'INTERNAL_ERROR',message:'Payment execution failed.'},{status:500})
 }
}
