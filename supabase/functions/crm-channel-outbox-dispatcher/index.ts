import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceRoleKey);
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });

type Outbox = { id:string; user_id:string; conversation_id:string|null; channel_account_id:string|null; channel:string; body:string; status:string; attempts:number; max_attempts:number; metadata:Record<string,unknown>|null };
type Account = { id:string; user_id:string; channel:string; provider:string; external_account_id:string|null; status:string; credentials_ref:string|null; metadata:Record<string,unknown>|null };
type Identity = { external_user_id:string|null; phone_e164:string|null; email:string|null; display_name:string|null; metadata:Record<string,unknown>|null };

function credentials(account: Account): Record<string,any> {
  if (!account.credentials_ref) return {};
  const raw = Deno.env.get(account.credentials_ref);
  if (!raw) throw new Error("provider_credentials_not_configured");
  try { return JSON.parse(raw); } catch { return { access_token: raw }; }
}
function meta(account: Account, key: string, fallback?: any) { return (account.metadata ?? {})[key] ?? fallback; }
function backoff(attempts: number) { return Math.min(60 * 60, Math.max(10, 2 ** Math.min(attempts, 10) * 5)); }
async function responseJson(r: Response) { const text = await r.text(); let data:any; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 1000) }; } if (!r.ok) throw new Error(`provider_http_${r.status}:${JSON.stringify(data).slice(0,900)}`); return data; }

async function sendMeta(account: Account, identity: Identity, body: string) {
  const c = credentials(account); const token = c.access_token || c.token; if (!token) throw new Error("meta_access_token_missing");
  const version = String(meta(account, "graph_version", "v23.0"));
  const base = `https://graph.facebook.com/${version}`;
  if (account.channel === "whatsapp") {
    const phoneNumberId = String(meta(account, "phone_number_id", account.external_account_id || "")); const to = identity.phone_e164 || identity.external_user_id;
    if (!phoneNumberId || !to) throw new Error("whatsapp_destination_missing");
    const r = await fetch(`${base}/${phoneNumberId}/messages`, { method:"POST", headers:{"authorization":`Bearer ${token}`,"content-type":"application/json"}, body:JSON.stringify({ messaging_product:"whatsapp", recipient_type:"individual", to, type:"text", text:{ preview_url:false, body } }) });
    const d = await responseJson(r); return String(d.messages?.[0]?.id || d.message_id || "");
  }
  const pageId = String(meta(account, "page_id", account.external_account_id || "")); const recipient = identity.external_user_id;
  if (!pageId || !recipient) throw new Error(`${account.channel}_destination_missing`);
  const r = await fetch(`${base}/${pageId}/messages`, { method:"POST", headers:{"authorization":`Bearer ${token}`,"content-type":"application/json"}, body:JSON.stringify({ recipient:{id:recipient}, message:{text:body} }) });
  const d = await responseJson(r); return String(d.message_id || d.id || "");
}
async function sendResend(account: Account, identity: Identity, body: string) {
  const c = credentials(account); const token = c.api_key || c.access_token || c.token; if (!token) throw new Error("resend_api_key_missing");
  const from = String(meta(account,"from_email",c.from || "")); const to = identity.email;
  if (!from || !to) throw new Error("email_destination_missing");
  const r = await fetch("https://api.resend.com/emails", { method:"POST", headers:{authorization:`Bearer ${token},`.replace(",",""),"content-type":"application/json"}, body:JSON.stringify({ from, to:[to], subject:String(meta(account,"subject","Mensagem da Althea Pay")), text:body }) });
  const d = await responseJson(r); return String(d.id || "");
}
async function sendTwilio(account: Account, identity: Identity, body: string) {
  const c = credentials(account); const sid = String(c.account_sid || account.external_account_id || ""); const auth = String(c.auth_token || ""); const from = String(meta(account,"from_number",c.from || "")); const to = identity.phone_e164;
  if (!sid || !auth || !from || !to) throw new Error("twilio_configuration_missing");
  const params = new URLSearchParams({ To:to, From:from, Body:body }); const basic = btoa(`${sid}:${auth}`);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method:"POST", headers:{authorization:`Basic ${basic}`,"content-type":"application/x-www-form-urlencoded"}, body:params });
  const d = await responseJson(r); return String(d.sid || "");
}
async function deliver(row: Outbox, account: Account|null, identity: Identity|null) {
  if (row.channel === "funnel_chat") {
    if (!row.conversation_id) throw new Error("conversation_id_required");
    const { data, error } = await db.from("crm_messages").insert({ conversation_id:row.conversation_id, user_id:row.user_id, direction:"outbound", channel:"funnel_chat", body:row.body, metadata:{ ...(row.metadata ?? {}), outbox_id:row.id, dispatcher:"crm-channel-outbox-dispatcher" } }).select("id").single();
    if (error) throw error; return String(data.id);
  }
  if (!account || account.status !== "active") throw new Error("channel_account_not_active");
  if (!identity) throw new Error("channel_identity_not_found");
  const provider = account.provider.toLowerCase();
  if (["meta_whatsapp","whatsapp_cloud","meta_instagram","instagram","meta_messenger","messenger"].includes(provider)) return sendMeta(account,identity,row.body);
  if (["resend","email_resend"].includes(provider)) return sendResend(account,identity,row.body);
  if (["twilio","sms_twilio"].includes(provider)) return sendTwilio(account,identity,row.body);
  throw new Error(`unsupported_channel_provider:${account.provider}`);
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({error:"method_not_allowed"},405);
  const internal = Deno.env.get("ALTHEA_INTERNAL_SECRET") || "";
  if (!internal || req.headers.get("x-internal-secret") !== internal) return json({error:"unauthorized"},401);
  try {
    const body = await req.json().catch(()=>({})); const limit = Math.max(1,Math.min(Number(body.limit || 25),100));
    await db.rpc("crm_requeue_stale_channel_outbox", { p_age_minutes:15 });
    const { data: rows, error: claimError } = await db.rpc("crm_claim_channel_outbox_worker", { p_limit:limit });
    if (claimError) throw claimError;
    const results:any[] = [];
    for (const row of (rows || []) as Outbox[]) {
      try {
        let account:Account|null = null;
        if (row.channel_account_id) { const { data, error } = await db.from("crm_channel_accounts").select("id,user_id,channel,provider,external_account_id,status,credentials_ref,metadata").eq("id",row.channel_account_id).eq("user_id",row.user_id).maybeSingle(); if (error) throw error; account = data as Account|null; }
        let identity:Identity|null = null;
        if (row.conversation_id && row.channel !== "funnel_chat") { const { data, error } = await db.from("crm_channel_identities").select("external_user_id,phone_e164,email,display_name,metadata").eq("conversation_id",row.conversation_id).eq("user_id",row.user_id).eq("channel",row.channel).order("updated_at",{ascending:false}).limit(1).maybeSingle(); if (error) throw error; identity = data as Identity|null; }
        const externalId = await deliver(row,account,identity);
        const now = new Date().toISOString();
        await db.from("crm_channel_message_outbox").update({status:"sent",external_message_id:externalId || null,sent_at:now,updated_at:now,last_error:null}).eq("id",row.id);
        if (row.channel !== "funnel_chat" && row.conversation_id) await db.from("crm_messages").insert({conversation_id:row.conversation_id,user_id:row.user_id,direction:"outbound",channel:row.channel,body:row.body,metadata:{...(row.metadata ?? {}),outbox_id:row.id,external_message_id:externalId || null,provider:account?.provider ?? null}});
        results.push({id:row.id,status:"sent",external_message_id:externalId || null});
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e); const terminal = row.attempts >= row.max_attempts; const next = new Date(Date.now()+backoff(row.attempts)*1000).toISOString();
        await db.from("crm_channel_message_outbox").update({status:terminal?"dead_letter":"queued",next_attempt_at:terminal?null:next,failed_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()}).eq("id",row.id);
        results.push({id:row.id,status:terminal?"dead_letter":"retry_scheduled",error:message});
      }
    }
    return json({ok:true,claimed:(rows||[]).length,results});
  } catch (e) { return json({ok:false,error:e instanceof Error?e.message:String(e)},500); }
});
