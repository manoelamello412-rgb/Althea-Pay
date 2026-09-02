import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const json=(b:unknown,s=200)=>Response.json(b,{status:s,headers:{"Content-Type":"application/json"}});
const enc=new TextEncoder();
async function sign(secret:string,body:string){const k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const x=await crypto.subtle.sign("HMAC",k,enc.encode(body));return Array.from(new Uint8Array(x)).map(v=>v.toString(16).padStart(2,"0")).join("")}
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const internal=Deno.env.get("ALTHEA_INTERNAL_SECRET")||"";if(!internal||req.headers.get("x-internal-secret")!==internal)return json({error:"unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!service)return json({error:"server_configuration_error"},500);
 let b:any;try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
 const userId=String(b.user_id??""),eventType=String(b.event_type??"order.approved"),eventId=String(b.event_id??crypto.randomUUID());if(!userId)return json({error:"user_id_required"},400);
 const db=createClient(url,service);const {data:webhooks,error}=await db.from("outbound_webhooks").select("*").eq("user_id",userId).eq("status","active");if(error)return json({error:"webhook_lookup_failed",detail:error.message},500);
 const payload={id:eventId,type:eventType,created_at:new Date().toISOString(),data:b.payload??{}};const body=JSON.stringify(payload);const results=[];
 for(const wh of webhooks??[]){if(!Array.isArray(wh.events)||(!wh.events.includes(eventType)&&!wh.events.includes("*")))continue;const idempotencyKey=`${eventId}:${wh.id}:${eventType}`;const secret=String(wh.secret_ref??"");let signature="";if(secret)signature=await sign(secret,body);
  const started=Date.now();let status="retry",code:number|null=null,errorMessage:string|null=null;
  try{const r=await fetch(String(wh.endpoint_url),{method:"POST",headers:{"content-type":"application/json","x-althea-event":eventType,"x-althea-event-id":eventId,"x-althea-idempotency-key":idempotencyKey, ...(signature?{"x-althea-signature":signature}:{})},body});code=r.status;if(r.ok)status="delivered";else errorMessage=`http_${r.status}`;}catch(e){errorMessage=e instanceof Error?e.message:"delivery_failed"}
  const attempt=1;await db.from("outbound_webhook_deliveries").upsert({webhook_id:wh.id,user_id:userId,event_id:b.event_db_id??null,event_type:eventType,idempotency_key:idempotencyKey,status,attempt,response_code:code,response_time_ms:Date.now()-started,error_message:errorMessage,payload,delivered_at:status==="delivered"?new Date().toISOString():null,next_retry_at:status==="retry"?new Date(Date.now()+60000).toISOString():null},{onConflict:"webhook_id,idempotency_key"});results.push({webhook_id:wh.id,status,response_code:code,error:errorMessage});
 }
 return json({ok:true,event_id:eventId,deliveries:results});
});