import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")||""; const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const secret=Deno.env.get("ALTHEA_INTERNAL_SECRET")||"";
const db=createClient(url,key); const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json"}});
Deno.serve(async req=>{if(req.method!=="POST")return out({error:"method_not_allowed"},405);if(!secret||req.headers.get("x-internal-secret")!==secret)return out({error:"unauthorized"},401);try{const body=await req.json().catch(()=>({}));const limit=Math.max(1,Math.min(Number(body.limit||500),5000));const {data,error}=await db.rpc("crm_predictive_capture_outcomes",{p_limit:limit});if(error)throw error;return out({ok:true,evaluated:Number(data||0)});}catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
