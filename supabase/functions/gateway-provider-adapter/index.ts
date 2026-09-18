import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertPublicHttpsUrl } from "../_shared/ssrf-guard.ts";

type O=Record<string,unknown>;
type Operation="create_payment"|"payment_status"|"retrieve_payment"|"retrieve"|"status"|"refund"|"health_check";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-althea-internal-secret,x-gateway-id,x-althea-gateway-id,x-althea-idempotency-key","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const obj=(v:unknown):v is O=>!!v&&typeof v==="object"&&!Array.isArray(v);
const str=(v:unknown)=>typeof v==="string"?v.trim():"";
const out=(v:O,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const get=(v:unknown,p:string):unknown=>{let c=v;for(const x of p.split(".").filter(Boolean)){if(!obj(c))return undefined;c=c[x]}return c};
const first=(v:O,ps:string[],f="")=>{for(const p of ps){const x=get(v,p);if(typeof x==="string"||typeof x==="number")return String(x)}return f};
const parse=async(r:Response):Promise<O>=>{const x=await r.json().catch(()=>({}));return obj(x)?x:{}};
const err=(p:O,f:string)=>{if(typeof p.error==="string")return p.error;if(obj(p.error)&&typeof p.error.message==="string")return p.error.message;if(typeof p.message==="string")return p.message;return f};
const norm=(s:string,map:O)=>{const v=s.toLowerCase().trim();if(typeof map[v]==="string"&&str(map[v]))return str(map[v]).toLowerCase();if(["processed","approved","authorized","succeeded","success","paid","received","confirmed","captured","accredited"].includes(v))return"approved";if(["pending","processing","in_process","in_analysis","requires_action","requires_confirmation","created","waiting","opened"].includes(v))return"pending";if(["declined","failed","failure","rejected","cancelled","canceled","refunded","chargeback","expired","overdue","rejected_by_risk"].includes(v))return"declined";return"error"};
const cfg=(v:unknown,n:string):O=>{if(!str(v))return{};try{const x=JSON.parse(String(v));if(!obj(x))throw new Error(`${n}_must_be_object`);return x}catch(e){throw new Error(e instanceof Error&&e.message.startsWith(n)?e.message:`${n}_invalid_json`)}};
const interpolate=(v:unknown,r:O):unknown=>{if(Array.isArray(v))return v.map(x=>interpolate(x,r));if(obj(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,interpolate(x,r)]));if(typeof v!=="string")return v;const m=v.match(/^\{\{\s*([^}]+?)\s*\}\}$/);if(m)return get(r,m[1].trim())??null;return v.replace(/\{\{\s*([^}]+?)\s*\}\}/g,(_,p)=>{const x=get(r,String(p).trim());return x==null?"":String(x)})};
const method=(v:unknown,f:string)=>{const m=(str(v)||f).toUpperCase();if(!["GET","POST","PUT","PATCH","DELETE"].includes(m))throw new Error("gateway_http_method_invalid");return m};

async function mercadoPago(operation:Operation,b:O,c:O){
  const token=str(c.access_token??c.api_key);if(!token)throw new Error("provider_access_token_missing");
  const base="https://api.mercadopago.com";
  const external=str(b.external_transaction_id??b.original_external_id??b.provider_transaction_id);
  const path=operation==="health_check"?"/users/me":operation==="refund"?(external?`/v1/orders/${encodeURIComponent(external)}/refund`:""):(["payment_status","retrieve_payment","retrieve","status"].includes(operation)?(external?`/v1/orders/${encodeURIComponent(external)}`:""):"/v1/orders");
  if(!path)throw new Error("external_transaction_id_required");
  const target=await assertPublicHttpsUrl(new URL(path,base).toString());if(!target.ok)throw new Error(`target_not_allowed:${target.reason}`);
  const key=str(b.idempotency_key);
  const headers:Record<string,string>={Accept:"application/json",Authorization:`Bearer ${token}`};
  if(key)headers["X-Idempotency-Key"]=key;
  const customer=obj(b.customer)?b.customer:{};
  const pm=obj(b.payment_method)?b.payment_method:{};
  const payer:O={};
  for(const k of ["email","entity_type","first_name","last_name","identification","phone","address"]){if(customer[k]!==undefined)payer[k]=customer[k]}
  let payload:O|undefined;
  if(operation==="create_payment"){
    const amount=Number(b.amount??0);if(!Number.isFinite(amount)||amount<=0)throw new Error("invalid_amount");
    const paymentMethod:O={...pm};
    if(b.payment_token!=null&&!paymentMethod.token)paymentMethod.token=b.payment_token;
    if(Object.keys(paymentMethod).length===0)throw new Error("payment_method_required");
    payload={type:"online",external_reference:str(b.transaction_id)||str(b.idempotency_key).slice(0,64),transactions:{payments:[{amount:amount.toFixed(2),payment_method:paymentMethod}]},payer};
    if(obj(b.metadata)&&b.metadata.description)payload.description=String(b.metadata.description).slice(0,255);
    payload.total_amount=amount.toFixed(2);payload.processing_mode="automatic";payload.capture_mode="automatic";
  }
  const init:RequestInit={method:method(operation==="health_check"?"GET":operation==="create_payment"?"POST":operation==="refund"?"POST":"GET","GET"),headers,signal:AbortSignal.timeout(15000)};
  if(payload){headers["Content-Type"]="application/json";init.body=JSON.stringify(payload)}
  const r=await fetch(target.url,init);const p=await parse(r);if(!r.ok)return out({ok:false,error:err(p,`gateway_http_${r.status}`),failure_code:first(p,["cause","code","error_code"],`http_${r.status}`)},r.status);
  if(operation==="health_check")return out({ok:true,status:"approved",provider_status:first(p,["status","state"],"healthy"),response:p});
  const id=first(p,["id","order_id","transactions.payments.0.id"],external),ps=first(p,["status","data.status","transactions.payments.0.status"],""),amount=first(p,["total_paid_amount","total_amount","transactions.payments.0.amount","amount"],String(b.amount??0)),currency=first(p,["currency_id","currency"],String(b.currency??"BRL"));
  return out({ok:true,id,external_id:id,status:norm(ps,{}),provider_status:ps,amount:Number(amount),currency:currency.toUpperCase(),response:p});
}

async function generic(operation:Operation,b:O,c:O){
  const checked=await assertPublicHttpsUrl(str(c.base_url));if(!checked.ok)throw new Error(`target_not_allowed:${checked.reason}`);
  const statusOps=["payment_status","retrieve_payment","retrieve","status"];
  const rawId=str(b.external_transaction_id??b.original_external_id??b.provider_transaction_id);
  const path=operation==="health_check"?(str(c.health_path)||"/health"):operation==="refund"?(str(c.refund_path)||"/payments/{id}"):statusOps.includes(operation)?(str(c.status_path)||"/payments/{id}"):(str(c.create_path)||"/payments");
  const target=await assertPublicHttpsUrl(new URL(path.replaceAll("{id}",encodeURIComponent(rawId)),checked.url).toString());if(!target.ok)throw new Error(`target_not_allowed:${target.reason}`);
  const root:O={amount:Number(b.amount??0),currency:str(b.currency||"BRL").toUpperCase(),transaction_id:str(b.transaction_id)||null,external_transaction_id:rawId||null,payment_token:str(b.payment_token)||null,payment_method:obj(b.payment_method)?b.payment_method:{},customer:obj(b.customer)?b.customer:{},metadata:obj(b.metadata)?b.metadata:{},idempotency_key:str(b.idempotency_key)||null,product_id:b.product_id??null,funnel_id:b.funnel_id??null};
  const headers:Record<string,string>={Accept:"application/json"};const token=str(c.api_key??c.access_token??c.secret_key??c.token);const ah=str(c.auth_header)||"Authorization";const ap=c.auth_prefix===""?"":str(c.auth_prefix)||"Bearer";if(token)headers[ah]=ap?`${ap} ${token}`:token;
  const blocked=new Set(["host","content-length","connection","transfer-encoding","x-althea-internal-secret","x-althea-gateway-id"]);
  const custom=cfg(c.custom_headers,"custom_headers");for(const[k,v]of Object.entries(custom)){if(blocked.has(k.toLowerCase())||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k))throw new Error("gateway_header_invalid");if(!["string","number","boolean"].includes(typeof v))throw new Error("gateway_header_value_invalid");headers[k]=String(interpolate(v,root))}
  if(root.idempotency_key){const ih=str(c.idempotency_header)||"Idempotency-Key";if(!headers[ih])headers[ih]=String(root.idempotency_key)}
  const m=method(operation==="health_check"?c.health_method:operation==="refund"?c.refund_method:statusOps.includes(operation)?c.status_method:c.create_method,operation==="health_check"||statusOps.includes(operation)?"GET":operation==="refund"?"POST":"POST");
  const template=str(c.request_template)?cfg(c.request_template,"request_template"):null;const payload=template?interpolate(template,root):{amount:root.amount,currency:root.currency,transaction_id:root.external_transaction_id||undefined,payment_token:root.payment_token||undefined,payment_method:root.payment_method,customer:root.customer,metadata:root.metadata};
  const init:RequestInit={method:m,headers,signal:AbortSignal.timeout(15000)};if(!["GET","DELETE"].includes(m)){headers["Content-Type"]="application/json";init.body=JSON.stringify(payload)}
  const r=await fetch(target.url,init);const p=await parse(r);if(!r.ok)return out({ok:false,error:err(p,`gateway_http_${r.status}`),failure_code:`http_${r.status}`},r.status);if(operation==="health_check")return out({ok:true,status:"approved",provider_status:first(p,["status","state","data.status"],"healthy"),response:p});
  const map=cfg(c.response_mapping,"response_mapping"),id=get(p,str(map.id)||"id")??first(p,["id","transaction_id","transactionId","payment_id","paymentId","data.id","data.transaction_id"],rawId),ps=String(get(p,str(map.status)||"status")??first(p,["status","payment_status","paymentStatus","state","data.status"],"")),amount=get(p,str(map.amount)||"amount")??first(p,["amount","value","data.amount"],String(root.amount)),currency=get(p,str(map.currency)||"currency")??first(p,["currency","data.currency"],root.currency);return out({ok:true,id:String(id??rawId),external_id:String(id??rawId),status:norm(ps,cfg(c.status_mapping,"status_mapping")),provider_status:ps,amount:Number(amount),currency:String(currency||root.currency).toUpperCase(),response:p});
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});if(req.method!=="POST")return out({ok:false,error:"method_not_allowed"},405);
  const su=Deno.env.get("SUPABASE_URL"),sr=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!su||!sr)return out({ok:false,error:"server_configuration_error"},500);const db=createClient(su,sr,{auth:{persistSession:false}});
  const supplied=req.headers.get("x-althea-internal-secret")??req.headers.get("x-internal-secret")??"";if(!supplied)return out({ok:false,error:"forbidden"},403);const verified=await db.rpc("verify_althea_internal_secret",{p_secret:supplied});if(verified.error)return out({ok:false,error:"internal_auth_unavailable"},500);if(verified.data!==true)return out({ok:false,error:"forbidden"},403);
  let b:O;try{const x=await req.json();if(!obj(x))return out({ok:false,error:"invalid_json"},400);b=x}catch{return out({ok:false,error:"invalid_json"},400)}
  const gid=str(b.gateway_id??req.headers.get("x-gateway-id")),op=str(b.operation).toLowerCase() as Operation;if(!gid||!op)return out({ok:false,error:!gid?"gateway_id_required":"operation_required"},422);
  const g=await db.from("gateways").select("id,provider,environment,status").eq("id",gid).maybeSingle();if(g.error||!g.data)return out({ok:false,error:"gateway_not_found"},404);
  if(op!=="health_check"&&!["connected","degraded"].includes(str(g.data.status).toLowerCase()))return out({ok:false,error:"gateway_not_operational"},422);
  const reg=await db.from("gateway_provider_registry").select("provider_key,adapter_key,operational,is_active").eq("provider_key",str(g.data.provider).toLowerCase()).eq("is_active",true).maybeSingle();if(reg.error)return out({ok:false,error:"provider_registry_lookup_failed"},500);if(!reg.data||reg.data.operational!==true)return out({ok:false,error:"provider_adapter_not_operational"},422);
  const cr=await db.rpc("resolve_gateway_credential_for_gateway",{p_gateway_id:gid});if(cr.error||!obj(cr.data))return out({ok:false,error:"provider_credential_missing"},422);const credential=obj(cr.data.credentials)?cr.data.credentials:cr.data;
  try{if(str(g.data.provider).toLowerCase()==="mercado_pago")return await mercadoPago(op,b,credential);return await generic(op,b,credential)}catch(e){return out({ok:false,error:e instanceof Error?e.message:"gateway_adapter_error"},502)}
});
