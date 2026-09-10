import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { importJWK, jwtVerify, type JWK } from "npm:jose@6.1.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-idempotency-key,idempotency-key,x-althea-feb-ticket-signature","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const rec=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):!rec(v)?v:Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
const hash=async(v:string)=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("")};
const jwk:JWK={kty:"RSA",n:"0AtznPufT2RK5iCGIsJHwoVW-j4NqyApGU4GD_uCGcr0hdbITAfnQPhpoGRV72rM7jXjaFb4tqbGIlQumpdFV5OYMa7YdxCZCL-bqOgNIy5ygyZ39tB4LMVpb_JfUb4WI546YT2AeTerg-w0gpGTVy8OIKDsFLul3yOVwDl0ltWpug2UFo6ylxF7_LmiqHkIc08juA7LSAdeoYy_MNMzw8JCi2YADvg_3IxlTB3osLPxSdA8hh0-FrvlzX9vWkjmy_vQSglN1LU-uHF_MUoOGEYRTFxAzjW4hRwODnnEmkTvUcmGsgbjQDDzymPNWQPV0ur_PTXJ696_BTXsoosbfQ",e:"AQAB",alg:"RS256",use:"sig",kid:"althea-feb-2026-09-10-k1"};

async function auth(req:Request){const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");if(!url||!key)return null;const a=req.headers.get("Authorization");if(!a)return null;const c=createClient(url,key,{global:{headers:{Authorization:a}}});const r=await c.auth.getUser();return r.error?null:r.data.user}
async function tenantMember(userId:string,tenantId:string){const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!service||!tenantId)return false;const db=createClient(url,service);const {data,error}=await db.from("organization_members").select("user_id").eq("organization_id",tenantId).eq("user_id",userId).maybeSingle();return !error&&!!data}

async function verify(req:Request,body:Record<string,unknown>,userId:string,action:string){
  const token=req.headers.get("x-althea-feb-ticket-signature")?.trim();
  if(!token)return{ok:false as const,status:401,code:"TICKET_INVALID"};
  try{
    const parts=token.split(".");if(parts.length!==3)throw new Error("malformed");
    const h=JSON.parse(atob(parts[0].replace(/-/g,"+").replace(/_/g,"/")));
    if(!rec(h)||h.alg!=="RS256"||h.kid!==jwk.kid)throw new Error("header");
    const key=await importJWK(jwk,"RS256");
    const v=await jwtVerify(token,key,{algorithms:["RS256"],issuer:Deno.env.get("IARA_FEB_ISSUER")??"althea-pay:iara-kernel",audience:Deno.env.get("IARA_FEB_AUDIENCE")??"althea-pay:gateway-orchestrator",clockTolerance:10});
    const p=v.payload,now=Math.floor(Date.now()/1000);
    if(typeof p.iat!=="number"||typeof p.exp!=="number"||now>p.exp||p.iat>now+10||now-p.iat>60)return{ok:false as const,status:403,code:"TICKET_EXPIRED"};
    if(typeof p.jti!=="string"||typeof p.executionId!=="string"||typeof p.tenantId!=="string"||typeof p.userId!=="string"||typeof p.gatewayId!=="string"||typeof p.toolKey!=="string"||typeof p.toolVersion!=="number"||typeof p.idempotencyKey!=="string")return{ok:false as const,status:403,code:"TICKET_INVALID"};
    if(p.userId!==userId||p.action!==action)return{ok:false as const,status:403,code:"TICKET_IDENTITY_MISMATCH"};
    if(!(await tenantMember(userId,p.tenantId)))return{ok:false as const,status:403,code:"AUTHORIZATION_DENIED"};
    const bodyGateway=typeof body.gateway_id==="string"?body.gateway_id.trim():"";
    if(bodyGateway&&bodyGateway!==p.gatewayId)return{ok:false as const,status:403,code:"TICKET_COMMAND_MISMATCH"};
    const input=rec(body.input)?body.input:body;
    const fingerprint=await hash(JSON.stringify(stable({tenant_id:p.tenantId,user_id:p.userId,tool_key:p.toolKey,tool_version:p.toolVersion,gateway_id:p.gatewayId,action:p.action,idempotency_key:p.idempotencyKey,input})));
    if(fingerprint!==p.requestFingerprint)return{ok:false as const,status:403,code:"TICKET_COMMAND_MISMATCH"};
    return{ok:true as const,jti:p.jti,executionId:p.executionId,tenantId:p.tenantId,userId:p.userId,toolKey:p.toolKey,toolVersion:p.toolVersion,gatewayId:p.gatewayId,action:p.action,idempotencyKey:p.idempotencyKey,issuer:String(p.iss??""),audience:String(p.aud??""),kid:String(h.kid),issuedAt:p.iat,expiresAt:p.exp,requestFingerprint:p.requestFingerprint};
  }catch{return{ok:false as const,status:403,code:"TICKET_INVALID"}}
}

async function consumeJti(ticket:Extract<Awaited<ReturnType<typeof verify>>,{ok:true}>){
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return{ok:false as const,code:"EXECUTION_UNAVAILABLE"};
  const db=createClient(url,service);
  const {error}=await db.from("feb_consumed_tickets").insert({jti:ticket.jti,execution_id:ticket.executionId,tenant_id:ticket.tenantId,user_id:ticket.userId,tool_key:ticket.toolKey,tool_version:ticket.toolVersion,gateway_id:ticket.gatewayId,action:ticket.action,idempotency_key:ticket.idempotencyKey,request_fingerprint:ticket.requestFingerprint,issuer:ticket.issuer,audience:ticket.audience,kid:ticket.kid,issued_at:new Date(ticket.issuedAt*1000).toISOString(),expires_at:new Date(ticket.expiresAt*1000).toISOString()});
  if(!error)return{ok:true as const};if(error.code==="23505")return{ok:false as const,code:"TICKET_REPLAYED"};return{ok:false as const,code:"EXECUTION_UNAVAILABLE"};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,code:"METHOD_NOT_ALLOWED",retryable:false},405);
  const user=await auth(req);if(!user)return json({ok:false,code:"UNAUTHORIZED",retryable:false},401);
  let body:Record<string,unknown>;try{const x=await req.json();if(!rec(x))return json({ok:false,code:"INVALID_JSON",retryable:false},400);body=x}catch{return json({ok:false,code:"INVALID_JSON",retryable:false},400)}
  const op=typeof body.operation==="string"?body.operation.toLowerCase():"create_payment";
  const action=op==="refund"?"refund":"purchase";
  if(op==="capture"||op==="void")return json({ok:false,code:"EXECUTION_UNAVAILABLE",retryable:false},503);
  const v=await verify(req,body,user.id,action);if(!v.ok)return json({ok:false,code:v.code,retryable:false},v.status);
  const consumed=await consumeJti(v);if(!consumed.ok)return json({ok:false,code:consumed.code,executionId:v.executionId,retryable:false},consumed.code==="TICKET_REPLAYED"?409:503);
  return json({ok:false,code:"EXECUTION_UNAVAILABLE",executionId:v.executionId,retryable:false},503);
});
