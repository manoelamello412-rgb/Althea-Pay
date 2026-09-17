import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type O=Record<string,unknown>;
const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const obj=(v:unknown):v is O=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const str=(v:unknown)=>typeof v==="string"?v.trim():"";
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers});

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")??"";
  const anon=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!url||!anon||!service)return json({ok:false,error:"server_configuration_error"},500);
  const auth=req.headers.get("Authorization")??"";
  if(!auth.startsWith("Bearer "))return json({ok:false,error:"unauthorized"},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const authResult=await userClient.auth.getUser();
  if(authResult.error||!authResult.data.user)return json({ok:false,error:"unauthorized"},401);
  let body:O;
  try{const parsed=await req.json();if(!obj(parsed))return json({ok:false,error:"invalid_json"},400);body=parsed}catch{return json({ok:false,error:"invalid_json"},400)}
  if(body.activate!==true)return json({ok:false,error:"explicit_activation_required"},400);
  const draftId=str(body.draft_id),productId=str(body.product_id),gatewayId=str(body.gateway_id);
  if(!draftId)return json({ok:false,error:"draft_id_required"},400);
  if(!productId)return json({ok:false,error:"product_id_required"},400);
  if(!gatewayId)return json({ok:false,error:"gateway_id_required"},400);
  const db=createClient(url,service,{auth:{persistSession:false}});
  const draft=await db.from("iara_funnel_drafts").select("id,user_id,status,schema_version,spec").eq("id",draftId).eq("user_id",authResult.data.user.id).maybeSingle();
  if(draft.error||!draft.data)return json({ok:false,error:"draft_not_found"},404);
  if(!["DRAFT","VALIDATED"].includes(String(draft.data.status)))return json({ok:false,error:"draft_not_activatable"},409);
  const spec=obj(draft.data.spec)?draft.data.spec:{};
  const name=str(spec.name)||"Funil criado pela Iara";
  const funnelType=["sales","lead_capture","launch","product","upsell_downsell","subscription","custom"].includes(str(body.funnel_type))?str(body.funnel_type):"sales";
  const connectionType=["script","webhook"].includes(str(body.connection_type))?str(body.connection_type):"script";
  const provision=await userClient.rpc("provision_funnel_commercial_atomic",{
    p_name:name,
    p_url:str(body.url)||null,
    p_connection_type:connectionType,
    p_funnel_type:funnelType,
    p_event_endpoint:str(body.event_endpoint)||null,
    p_product_id:productId,
    p_gateway_id:gatewayId,
  });
  if(provision.error||!obj(provision.data))return json({ok:false,error:"funnel_provision_failed",detail:provision.error?.message??null},409);
  const funnel=obj(provision.data.funnel)?provision.data.funnel:{};
  const funnelId=str(funnel.id);
  if(!funnelId)return json({ok:false,error:"funnel_provision_invalid_result"},500);
  const runtime=await db.from("iara_funnel_runtime_specs").insert({user_id:authResult.data.user.id,funnel_id:funnelId,draft_id:draftId,spec}).select("id,funnel_id,draft_id,published_at").single();
  if(runtime.error)return json({ok:false,error:"runtime_spec_persist_failed",funnel_id:funnelId},500);
  const updated=await db.from("iara_funnel_drafts").update({status:"ACTIVATED",funnel_id:funnelId,updated_at:new Date().toISOString()}).eq("id",draftId).eq("user_id",authResult.data.user.id);
  if(updated.error)return json({ok:false,error:"draft_activation_state_failed",funnel_id:funnelId},500);
  return json({ok:true,provision:provision.data,runtime_spec:runtime.data});
});
