import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  return new Response(JSON.stringify({ok:false,code:"EXECUTION_UNAVAILABLE",reason:"DIRECT_PROVIDER_ADAPTER_RETIRED",retryable:false}),{status:410,headers});
});
