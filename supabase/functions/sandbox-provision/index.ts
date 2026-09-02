import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"content-type":"application/json"}});

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const auth=req.headers.get('authorization')||'';
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token) return json({error:'unauthorized'},401);
  const userClient=createClient(URL,ANON,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error:authError}=await userClient.auth.getUser(token);
  if(authError||!user) return json({error:'unauthorized'},401);
  const db=createClient(URL,SERVICE);
  const body=await req.json().catch(()=>({}));
  const funnelId=body?.funnel_id?String(body.funnel_id):null;
  if(funnelId){
    const {data:funnel}=await db.from('funnels').select('id').eq('id',funnelId).eq('user_id',user.id).is('deleted_at',null).maybeSingle();
    if(!funnel) return json({error:'funnel_not_found'},404);
  }
  const {data:gateways}=await db.from('gateways').select('id,data').eq('user_id',user.id).order('created_at',{ascending:true});
  const existing=(gateways||[]).find(g=>String(g.data?.provider||'').toLowerCase()==='sandbox' && String(g.data?.environment||'sandbox').toLowerCase()==='sandbox');
  let gatewayId=existing?.id;
  if(!gatewayId){
    gatewayId=`sandbox_${crypto.randomUUID().replaceAll('-','')}`;
    const ins=await db.from('gateways').insert({id:gatewayId,user_id:user.id,data:{name:'ALTHEA Sandbox',provider:'sandbox',environment:'sandbox',status:'active',custody:false,capabilities:['create_payment','refund','chargeback_simulation','technical_failure_simulation','card_decline_simulation']}});
    if(ins.error) return json({error:'sandbox_gateway_create_failed',detail:ins.error.message},500);
  }
  let q=db.from('funnels').select('id').eq('user_id',user.id).is('deleted_at',null);
  if(funnelId) q=q.eq('id',funnelId);
  const {data:funnels}=await q;
  let routeCount=0;
  for(const f of funnels||[]){
    const {data:route}=await db.from('gateway_routes').select('id').eq('user_id',user.id).eq('funnel_id',f.id).is('product_id',null).eq('gateway_id',gatewayId).maybeSingle();
    if(!route){
      const ins=await db.from('gateway_routes').insert({user_id:user.id,funnel_id:f.id,product_id:null,gateway_id:gatewayId,priority:10,enabled:true,fallback_enabled:true,conditions:{health_guard:true,environment:'sandbox'}});
      if(!ins.error) routeCount++;
    }
  }
  return json({ok:true,gateway_id:gatewayId,route_count:routeCount,sandbox:true,custody:false});
});
