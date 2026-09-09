import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const secret=Deno.env.get("ALTHEA_INTERNAL_SECRET")||"";if(!secret||req.headers.get("x-internal-secret")!==secret)return json({error:"unauthorized"},401);
 try{
  const b=await req.json().catch(()=>({}));const limit=Math.max(1,Math.min(Number(b.limit||25),100));
  const{data:rows,error}=await db.rpc("crm_claim_automation_retries",{p_limit:limit});if(error)throw error;
  const results=[];const url=`${Deno.env.get("SUPABASE_URL")}/functions/v1/automation-engine-v2`;
  for(const row of rows||[]){
   try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-internal-secret":secret},body:JSON.stringify({retry_execution_id:row.id})});const payload=await r.json().catch(()=>({}));if(!r.ok)throw Error(String(payload.error||`automation_engine_http_${r.status}`));results.push(payload);}
   catch(e){const message=e instanceof Error?e.message:String(e);const terminal=Number(row.attempt_count)>=Number(row.max_attempts);if(terminal)await db.rpc("crm_mark_automation_dead_letter",{p_execution_id:row.id,p_error:message});else await db.from("automation_executions").update({status:"failed",error_message:message,next_retry_at:new Date(Date.now()+30000).toISOString(),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id);results.push({execution_id:row.id,status:terminal?"dead_letter":"failed",error:message});}
  }
  return json({ok:true,claimed:(rows||[]).length,results});
 }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
