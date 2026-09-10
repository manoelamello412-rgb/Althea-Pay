import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type O=Record<string,unknown>;
const url=Deno.env.get("SUPABASE_URL")??"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const internal=Deno.env.get("ALTHEA_INTERNAL_SECRET")??"";
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const text=(v:unknown)=>typeof v==="string"?v.trim():"";
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(v));
const db=createClient(url,service,{auth:{persistSession:false}});

function responseFor(conv:O,checkout:O|null,latest:O|null){
  const reason=text(conv.gateway_error_log);
  const customer=text(conv.buyer_name)||"Olá";
  if(reason)return `${customer}, estou acompanhando o pagamento e identifiquei um retorno técnico registrado no checkout. Posso te orientar pelo próximo passo disponível, sem prometer aprovação antes da confirmação do pagamento.`;
  if(checkout)return `${customer}, vi que seu checkout ficou pendente. Posso continuar com você por aqui e te orientar para concluir o pagamento.`;
  if(latest)return `${customer}, recebi sua mensagem. Vou continuar o atendimento por aqui e te ajudar com o próximo passo.`;
  return `${customer}, estou por aqui para continuar seu atendimento.`;
}

Deno.serve(async req=>{
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!internal||req.headers.get("x-althea-internal-secret")!==internal)return json({ok:false,error:"forbidden"},403);
  if(!url||!service)return json({ok:false,error:"server_configuration_error"},500);
  const {data:conversations,error}=await db.from("crm_conversations").select("id,user_id,funnel_id,transaction_id,buyer_name,status,last_inbound_at,last_message_direction,primary_channel,channel_account_id,gateway_error_log").eq("status","open").eq("last_message_direction","inbound").order("last_inbound_at",{ascending:true}).limit(50);
  if(error)return json({ok:false,error:"conversation_scan_failed"},500);
  let activated=0,queued=0,skipped=0;
  for(const conv of (conversations??[]) as O[]){
    const userId=text(conv.user_id),conversationId=text(conv.id);
    if(!uuid(userId)||!uuid(conversationId)){skipped++;continue;}
    const [agents,active,checkout,latest]=await Promise.all([
      db.from("crm_agents").select("id,status").eq("user_id",userId),
      db.from("iara_commercial_interventions").select("id,state,control_mode").eq("conversation_id",conversationId).in("state",["ELIGIBLE","ACTIVE"]).maybeSingle(),
      conv.funnel_id?db.from("checkout_sessions").select("id,status,amount,currency,updated_at,abandoned_at").eq("user_id",userId).eq("funnel_id",text(conv.funnel_id)).in("status",["started","pending"]).is("abandoned_at",null).order("updated_at",{ascending:false}).limit(1):Promise.resolve({data:[],error:null}),
      db.from("crm_messages").select("id,body,created_at,direction").eq("conversation_id",conversationId).eq("user_id",userId).eq("direction","inbound").order("created_at",{ascending:false}).limit(1)
    ]);
    if(agents.error||active.error||checkout.error||latest.error){skipped++;continue;}
    if((agents.data??[]).some((a:O)=>text(a.status)==="available")||active.data){skipped++;continue;}
    const checkoutRow=((checkout.data??[])[0] as O|undefined)??null;
    const lastInbound=Date.parse(text(conv.last_inbound_at));
    const afterHours=Number.isFinite(lastInbound)&&Date.now()-lastInbound>=5*60*1000;
    if(!checkoutRow&&!afterHours&&text(conv.last_message_direction)!=="inbound"){skipped++;continue;}
    const ins=await db.from("iara_commercial_interventions").insert({user_id:userId,conversation_id:conversationId,checkout_id:checkoutRow?.id??null,control_mode:"IARA",trigger_type:checkoutRow?"CHECKOUT_STALL":afterHours?"AFTER_HOURS":"CUSTOMER_REQUEST",state:"ACTIVE",takeover_at:new Date().toISOString(),last_customer_message_at:conv.last_inbound_at??null,metadata:{source:"iara-commercial-intervention-worker",human_available:false}}).select("id").single();
    if(ins.error){skipped++;continue;}
    activated++;
    const channel=text(conv.primary_channel).toLowerCase();
    const account=text(conv.channel_account_id);
    if(!["funnel_chat","whatsapp","instagram","messenger","email","sms"].includes(channel)||!uuid(account))continue;
    const body=responseFor(conv,checkoutRow,((latest.data??[])[0] as O|undefined)??null);
    const idem=`iara-intervention:${text(ins.data.id)}`;
    const out=await db.from("crm_channel_message_outbox").insert({user_id:userId,conversation_id:conversationId,channel_account_id:account,channel,idempotency_key:idem,direction:"outbound",body,status:"queued",metadata:{source:"iara-commercial-intervention-worker",intervention_id:ins.data.id,autonomous:true}});
    if(!out.error)queued++;
  }
  return json({ok:true,activated,queued,skipped});
});
