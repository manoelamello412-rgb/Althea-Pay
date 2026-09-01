import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-internal-secret"}})

Deno.serve(withSupabase({auth:'none'},async(req,ctx)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-internal-secret"}})
  const provided=req.headers.get('x-internal-secret')
  const {data:secret}=await ctx.supabaseAdmin.rpc('get_althea_internal_secret')
  if(!secret || !provided || provided!==secret)return json({error:'unauthorized'},401)
  if(req.method!=='POST')return json({error:'method_not_allowed'},405)
  let body:any;try{body=await req.json()}catch{return json({error:'invalid_json'},400)}
  const userId=String(body.user_id??'');const rows=Array.isArray(body.settlement_rows)?body.settlement_rows:[];const gatewayId=body.gateway_id?String(body.gateway_id):null
  if(!userId||!rows.length)return json({error:'user_id_and_settlement_rows_required'},400)
  const start=body.period_start?new Date(body.period_start).toISOString():new Date(Date.now()-86400000).toISOString();const end=body.period_end?new Date(body.period_end).toISOString():new Date().toISOString()
  const {data:run,error:runError}=await ctx.supabaseAdmin.from('reconciliation_runs').insert({user_id:userId,gateway_id:gatewayId,period_start:start,period_end:end,status:'running',source_type:'gateway_report',source_reference:body.source_reference??null,started_at:new Date().toISOString()}).select().single()
  if(runError)return json({error:'run_create_failed',detail:runError.message},500)
  let matched=0,mismatch=0,grossExpected=0,grossReported=0
  try{
    for(const row of rows){
      const external=String(row.external_transaction_id??row.transaction_id??'');const reported=Number(row.amount??row.gross??0);grossReported+=reported
      let q=ctx.supabaseAdmin.from('gateway_transactions').select('id,amount,external_id,gateway_id').eq('user_id',userId).limit(1);if(external)q=q.eq('external_id',external);if(gatewayId)q=q.eq('gateway_id',gatewayId)
      const {data:tx,error}=await q.maybeSingle();if(error)throw error
      if(!tx){mismatch++;await ctx.supabaseAdmin.from('reconciliation_items').insert({user_id:userId,run_id:run.id,external_transaction_id:external||null,status:'missing_internal',reported_amount:reported,discrepancy_amount:reported,mismatch_reason:'transaction_not_found',gateway_payload:row});continue}
      const expected=Number(tx.amount);grossExpected+=expected;const diff=Math.round((expected-reported)*100)/100
      const status=Math.abs(diff)<0.01?'matched':'amount_mismatch';if(status==='matched')matched++;else mismatch++
      await ctx.supabaseAdmin.from('reconciliation_items').insert({user_id:userId,run_id:run.id,transaction_id:tx.id,external_transaction_id:external||tx.external_id,status,expected_amount:expected,reported_amount:reported,discrepancy_amount:diff,mismatch_reason:status==='matched'?null:'amount_difference',gateway_payload:row})
    }
    const discrepancy=Math.round((grossExpected-grossReported)*100)/100
    await ctx.supabaseAdmin.from('reconciliation_runs').update({status:'completed',matched_count:matched,mismatch_count:mismatch,gross_expected:grossExpected,gross_reported:grossReported,discrepancy_amount:discrepancy,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',run.id)
    return json({run_id:run.id,status:'completed',matched_count:matched,mismatch_count:mismatch,gross_expected:grossExpected,gross_reported:grossReported,discrepancy_amount:discrepancy})
  }catch(e){await ctx.supabaseAdmin.from('reconciliation_runs').update({status:'failed',error_message:String(e),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',run.id);return json({error:'reconciliation_failed',detail:String(e),run_id:run.id},500)}
}))
