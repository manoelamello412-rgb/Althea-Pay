import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET,OPTIONS"};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="GET")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
  const started=Date.now();
  return new Response(JSON.stringify({ok:true,service:"althea-api",version:"v2",status:"ok",checks:{runtime:"ok"},latency_ms:Date.now()-started,timestamp:new Date().toISOString()}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
});
