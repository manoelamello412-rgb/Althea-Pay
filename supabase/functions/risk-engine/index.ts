import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const encoder=new TextEncoder();
const hash=async(v:string)=>{const h=await crypto.subtle.digest("SHA-256",encoder.encode(v));return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,"0")).join("")};

Deno.serve(async req=>{
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  const internal=Deno.env.get("ALTHEA_INTERNAL_SECRET")||"";
  if(!internal || req.headers.get("x-internal-secret")!==internal) return json({error:"unauthorized"},401);
  let b:any; try{b=await req.json()}catch{return json({error:"invalid_json"},400)}
  const amount=Number(b.amount??0), userId=String(b.user_id??"");
  if(!userId||!Number.isFinite(amount)||amount<=0)return json({error:"user_id_and_positive_amount_required"},400);

  const forced=String(b.metadata?.risk_simulation??"").toLowerCase();
  if(forced==="critical"||forced==="high") return json({decision:"blocked",risk_score:95,risk_level:"critical",reason_codes:["simulation_high_risk"]});
  if(forced==="medium") return json({decision:"review",risk_score:72,risk_level:"high",reason_codes:["simulation_review"]});

  const payload={user_id:userId,amount,currency:String(b.currency??"BRL"),customer:b.customer??{},metadata:b.metadata??{},ip:b.ip??null,device_id:b.device_id??null,card_fingerprint:b.card_fingerprint??null};
  const provider=String(Deno.env.get("RISK_PROVIDER")||"heuristic").toLowerCase();
  const endpoint=provider!=="heuristic"?Deno.env.get(`RISK_PROVIDER_URL_${provider.toUpperCase()}`):null;
  let score:number|null=null,level="low",decision="allow",reasonCodes:string[]=[];
  let providerAvailable=true;

  if(endpoint){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),900);
    try{
      const r=await fetch(endpoint,{method:"POST",signal:controller.signal,headers:{"content-type":"application/json","x-althea-user-id":userId,"x-althea-request-id":crypto.randomUUID()},body:JSON.stringify(payload)});
      const p:any=await r.json().catch(()=>({}));
      if(r.ok){score=Number(p.risk_score??p.score);if(!Number.isFinite(score))score=null;level=String(p.risk_level??(score!==null&&score>=85?"critical":score!==null&&score>=70?"high":"low"));decision=String(p.decision??(level==="critical"?"blocked":level==="high"?"review":"allow"));reasonCodes=Array.isArray(p.reason_codes)?p.reason_codes.map(String):[]}
      else {providerAvailable=false;reasonCodes=[`provider_http_${r.status}`]}
    }catch(e){providerAvailable=false;reasonCodes=[e instanceof DOMException&&e.name==="AbortError"?"provider_timeout":"provider_unavailable"]}
    finally{clearTimeout(timer)}
  }

  if(score===null){
    const email=String(b.customer?.email??"").toLowerCase();const ip=String(b.ip??"");
    const signals:number[]=[];
    if(amount>=10000)signals.push(15); if(!email||!email.includes("@"))signals.push(15); if(ip.length<7)signals.push(5);
    score=Math.min(100,20+signals.reduce((a,c)=>a+c,0));
    level=score>=85?"critical":score>=70?"high":"low";decision=level==="critical"?"blocked":level==="high"?"review":"allow";
    reasonCodes=[...reasonCodes,...(signals.length?["heuristic_signals"]:["baseline_low_risk"]),...(providerAvailable?[]:["risk_provider_unavailable_fail_open"])];
  }

  const dbUrl=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(dbUrl&&service){const admin=createClient(dbUrl,service);const {error}=await admin.from("risk_assessments").insert({user_id:userId,external_reference:String(b.idempotency_key??crypto.randomUUID()),amount,currency:String(b.currency??"BRL"),risk_score:score,risk_level:level,decision,provider,reason_codes:reasonCodes,signals:{ip_present:Boolean(b.ip),device_present:Boolean(b.device_id),card_fingerprint_present:Boolean(b.card_fingerprint),provider_available:providerAvailable},created_at:new Date().toISOString()});if(error)console.error("risk.persist_failed",error.message);}
  return json({decision,risk_score:score,risk_level:level,reason_codes:reasonCodes,provider,provider_available:providerAvailable,fail_open:!providerAvailable,latency_target_ms:900});
});