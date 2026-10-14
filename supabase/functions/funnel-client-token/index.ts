import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")??"";
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type,x-funnel-event-token,x-request-id",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Cache-Control":"no-store"
};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"content-type":"application/json"}});
const clean=(v:unknown,max=500)=>typeof v==="string"&&v.trim()?v.trim().slice(0,max):null;
const sha256=async(v:string)=>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")};
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const encode=(value:string)=>b64url(new TextEncoder().encode(value));
async function sign(secret:string,value:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value))))}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST")return out({error:"method_not_allowed"},405);
  if(!URL||!KEY)return out({error:"server_not_configured"},500);

  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  const raw=req.headers.get("x-funnel-event-token")?.trim()??"";
  let binding:{user_id:unknown;funnel_id:unknown;token_id:string|null};
  if(raw){
    if(raw.length<32||raw.length>256)return out({error:"funnel_event_token_required"},401);
    const resolved=await db.rpc("resolve_funnel_ingestion_token",{p_token_hash:await sha256(raw)}).maybeSingle<{user_id:string;funnel_id:string;token_id:string}>();
    if(resolved.error||!resolved.data)return out({error:"invalid_funnel_event_token"},401);
    binding={user_id:resolved.data.user_id,funnel_id:resolved.data.funnel_id,token_id:String(resolved.data.token_id)};
  }else{
    // Public snippet: the browser's Origin must match the funnel's registered page URL.
    const requestedFunnel=clean(body.funnel_id,255);
    const origin=req.headers.get("origin")??"";
    if(!requestedFunnel||!origin)return out({error:"funnel_event_token_required"},401);
    const ip=(req.headers.get("x-forwarded-for")??"").split(",")[0].trim()||"unknown";
    const rate=await db.rpc("consume_funnel_event_rate_limit",{p_bucket_key:`client-token:${requestedFunnel}:${ip}`,p_limit:30,p_window_seconds:60});
    const rateState=Array.isArray(rate.data)?rate.data[0]:rate.data;
    if(rate.error)return out({error:"rate_limit_unavailable"},503);
    if(!rateState?.allowed)return out({error:"rate_limited",reset_at:rateState?.reset_at??null},429);
    const resolved=await db.rpc("resolve_funnel_public_origin",{p_funnel_id:requestedFunnel,p_origin:origin}).maybeSingle<{user_id:string;funnel_id:string}>();
    if(resolved.error||!resolved.data)return out({error:"origin_not_allowed"},403);
    // ponytail: all snippet visitors of a funnel share funnel-events' 600/min bucket (keyed by kid); key by jti if a page outgrows it.
    binding={user_id:resolved.data.user_id,funnel_id:resolved.data.funnel_id,token_id:null};
  }

  const requestedTtl=Number(body.ttl_seconds??600);
  const ttl=Math.min(600,Math.max(60,Number.isFinite(requestedTtl)?Math.trunc(requestedTtl):600));
  const funnelId=clean(binding.funnel_id,255);
  const userId=clean(binding.user_id,100);
  if(!funnelId||!userId)return out({error:"invalid_funnel_binding"},500);

  const secretResult=await db.rpc("get_althea_internal_secret");
  const signingSecret=!secretResult.error&&typeof secretResult.data==="string"?secretResult.data:"";
  if(!signingSecret)return out({error:"connector_signing_unavailable"},503);

  const now=Math.floor(Date.now()/1000);
  const payload={
    iss:"althea-pay",
    aud:"althea-funnel-events",
    sub:userId,
    funnel_id:funnelId,
    kid:binding.token_id??`origin:${funnelId}`,
    scope:["events:write"],
    iat:now,
    exp:now+ttl,
    jti:crypto.randomUUID(),
    v:1
  };
  const encoded=encode(JSON.stringify(payload));
  const signature=await sign(signingSecret,encoded);
  const token=`alt_fct_${encoded}.${signature}`;

  if(binding.token_id)await db.from("funnel_ingestion_tokens").update({last_used_at:new Date().toISOString()}).eq("id",binding.token_id);

  return out({
    token,
    token_type:"Bearer",
    expires_in:ttl,
    expires_at:new Date((now+ttl)*1000).toISOString(),
    funnel_id:funnelId,
    event_endpoint:`${URL.replace(/\/$/,"")}/functions/v1/funnel-events`,
    protocol_version:"1"
  });
});
