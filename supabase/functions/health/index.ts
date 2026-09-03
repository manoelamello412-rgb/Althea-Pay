import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET,OPTIONS"};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="GET")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
  const started=Date.now(),url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return new Response(JSON.stringify({ok:false,service:"althea-api",status:"degraded",checks:{database:"configuration_error",queue:"managed-by-event-worker"},latency_ms:Date.now()-started,timestamp:new Date().toISOString()}),{status:503,headers:{...cors,"Content-Type":"application/json"}});
  let database:"ok"|"error"="ok";
  try{const db=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});const{error}=await db.from("platform_health_checks").select("id").limit(1);if(error)database="error";}catch{database="error";}
  const ok=database==="ok";
  return new Response(JSON.stringify({ok,service:"althea-api",version:"v2",status:ok?"ok":"degraded",checks:{database,queue:"managed-by-event-worker"},latency_ms:Date.now()-started,timestamp:new Date().toISOString()}),{status:ok?200:503,headers:{...cors,"Content-Type":"application/json"}});
});
