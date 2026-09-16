import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-gateway-id,x-provider-event-id,stripe-signature,x-signature,x-request-id,asaas-access-token,x-webhook-signature","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
const rec=(v:unknown):v is JsonRecord=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");
const safe=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;};
async function hmac(secret:string,value:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));}
const first=(obj:JsonRecord,keys:string[])=>{for(const k of keys){const v=obj[k];if(v!==undefined&&v!==null&&String(v).trim()!=="")return v;}return undefined;};
const normalizeStatus=(v:unknown)=>{const s=String(v??"").toLowerCase().trim();if(["approved","paid","succeeded","success","completed","complete"].includes(s))return "approved";if(["pending","processing","waiting","authorized"].includes(s))return "pending";if(["failed","failure","declined","denied","canceled","cancelled"].includes(s))return "failed";if(["refunded","refund"].includes(s))return "refunded";if(["chargeback","disputed","dispute"].includes(s))return "chargeback";if(s==="created")return "created";return null;};
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return json({error:"method_not_allowed"},405);
 const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),supabaseUrl=Deno.env.get("SUPABASE_URL");
 if(!serviceRole||!supabaseUrl)return json({error:"server_configuration_error"},500);
 const url=new URL(request.url);const gatewayId=(request.headers.get("x-gateway-id")??url.searchParams.get("gateway_id")??"").trim();
 if(!gatewayId)return json({error:"gateway_id_required"},400);
 const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false}});
 const gateway=await admin.from("gateways").select("id,provider,environment,status,data").eq("id",gatewayId).maybeSingle();
 if(gateway.error||!gateway.data)return json({error:"gateway_not_found"},404);
 const provider=String(gateway.data.provider).toLowerCase();
 const secretResult=await admin.rpc("resolve_gateway_webhook_secret",{p_gateway_id:gatewayId});
 if(secretResult.error||!secretResult.data)return json({error:"webhook_secret_not_configured"},503);
 const secret=String(secretResult.data);const rawBody=await request.text();if(rawBody.length>1024*1024)return json({error:"payload_too_large"},413);
 let payload:JsonRecord;try{const parsed=JSON.parse(rawBody);if(!rec(parsed))return json({error:"invalid_payload"},400);payload=parsed;}catch{return json({error:"invalid_json"},400)}
 let valid=false;
 if(provider==="stripe"){
  const header=request.headers.get("stripe-signature")??"";const pairs=Object.fromEntries(header.split(",").map(x=>{const [k,...v]=x.split("=");return[k,v.join("=")]}));const timestamp=Number(pairs.t),signature=String(pairs.v1??"");if(!Number.isFinite(timestamp)||!signature||Math.abs(Date.now()-timestamp*1000)>300000)return json({error:"invalid_or_stale_signature"},401);valid=safe(await hmac(secret,`${timestamp}.${rawBody}`),signature.toLowerCase());
 }else if(provider==="asaas"){
  valid=safe(secret,request.headers.get("asaas-access-token")??"");
 }else if(provider==="mercado_pago"){
  const signature=request.headers.get("x-signature")??"",requestId=request.headers.get("x-request-id")??"",dataId=url.searchParams.get("data.id")??(rec(payload.data)?String(payload.data.id??""):"");const parts=Object.fromEntries(signature.split(",").map(x=>{const [k,...v]=x.split("=");return[k,v.join("=")]}));const timestamp=String(parts.ts??""),v1=String(parts.v1??"");if(!timestamp||!v1||Math.abs(Date.now()-Number(timestamp)*1000)>300000)return json({error:"invalid_or_stale_signature"},401);valid=safe(await hmac(secret,`id:${dataId};request-id:${requestId};ts:${timestamp};`),v1.toLowerCase());
 }else{
  const registry=await admin.from("gateway_provider_registry").select("webhook_config,is_active,operational").eq("provider_key",provider).maybeSingle();
  if(registry.error||!registry.data||registry.data.is_active!==true)return json({error:"unsupported_webhook_provider"},422);
  const cfg=rec(registry.data.webhook_config)?registry.data.webhook_config:{};const gatewayData=rec(gateway.data.data)?gateway.data.data:{};const gatewayWebhook=rec(gatewayData.webhook)?gatewayData.webhook:{};
  const headerName=String(gatewayWebhook.signature_header??cfg.signature_header??"x-webhook-signature").toLowerCase();const supplied=request.headers.get(headerName)??"";const algorithm=String(gatewayWebhook.signature_algorithm??cfg.signature_algorithm??"hmac-sha256").toLowerCase();
  if(algorithm!=="hmac-sha256")return json({error:"unsupported_webhook_signature_algorithm"},422);
  const signedValue=String(gatewayWebhook.signature_value??cfg.signature_value??rawBody);const expected=await hmac(secret,signedValue===rawBody?rawBody:signedValue);valid=safe(expected,supplied.replace(/^sha256=/i,"").trim().toLowerCase());
 }
 if(!valid)return json({error:"invalid_signature"},401);
 const eventId=(request.headers.get("x-provider-event-id")??String(first(payload,["id","event_id","eventId"])??"")).trim();if(!eventId||eventId.length>300)return json({error:"provider_event_id_required"},400);
 const ingested=await admin.rpc("ingest_gateway_webhook_v2",{p_gateway_id:gatewayId,p_provider:provider,p_provider_event_id:eventId,p_signature_timestamp:new Date().toISOString(),p_payload:{...payload,_althea_gateway_id:gatewayId}});
 if(ingested.error)return json({error:"webhook_ingestion_failed",detail:ingested.error.message},500);
 const row=Array.isArray(ingested.data)?ingested.data[0]:ingested.data;if(row?.duplicate)return json({ok:true,duplicate:true,event_id:eventId,webhook_id:row?.webhook_id??null});
 const body=rec(payload.data)?{...payload,...payload.data}:payload;const status=normalizeStatus(first(body,["status","payment_status","paymentStatus","transaction_status","transactionStatus"]));const externalId=String(first(body,["external_transaction_id","external_id","transaction_id","transactionId","payment_id","paymentId"])??"").trim();
 if(!status||!externalId)return json({ok:true,accepted:true,event_id:eventId,webhook_id:row?.webhook_id??null,processed:false,reason:"awaiting_normalized_transaction_fields"},202);
 const amountValue=first(body,["amount","value","total_amount","totalAmount"]);const amount=amountValue===undefined?null:Number(amountValue);const currencyValue=first(body,["currency","currency_code","currencyCode"]);const currency=currencyValue===undefined?null:String(currencyValue);
 const eventKind=status==="refunded"?"refund":status==="chargeback"?"chargeback":"payment";
 const processed=await admin.rpc("process_gateway_webhook_v11",{p_webhook_id:row.webhook_id,p_next_status:status,p_external_transaction_id:externalId,p_failure_code:status==="failed"?String(first(body,["failure_code","failureCode","error_code","errorCode"])??"")||null:null,p_event_kind:eventKind,p_amount:Number.isFinite(amount??NaN)?amount:null,p_currency:currency,p_external_event_id:eventId});
 if(processed.error)return json({error:"webhook_processing_failed",detail:processed.error.message,event_id:eventId,webhook_id:row?.webhook_id??null},500);
 return json({ok:true,accepted:true,processed:true,event_id:eventId,webhook_id:row?.webhook_id??null,status,external_transaction_id:externalId},200);
});
