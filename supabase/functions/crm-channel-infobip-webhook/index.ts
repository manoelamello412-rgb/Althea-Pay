import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseInfobipWebhook } from "../_shared/infobip.ts";

// Configure in Infobip (inbound messages + delivery/seen reports):
//   <SUPABASE_URL>/functions/v1/crm-channel-infobip-webhook?account=<crm_channel_accounts.id>&token=<webhook_token>
// webhook_token lives in the account credentials (Vault when configured in CRM > Configurações > WhatsApp,
// or the legacy credentials_ref env JSON). Infobip does not sign
// webhooks, so the per-account token in the URL is the authenticator.

type Account = { id: string; user_id: string; provider: string; channel: string; status: string; credentials_ref: string | null };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function webhookToken(account: Account): Promise<string> {
  if (!account.credentials_ref) {
    const { data } = await db.rpc("crm_channel_account_credentials", { p_account_id: account.id });
    return typeof data?.webhook_token === "string" ? data.webhook_token : "";
  }
  const raw = Deno.env.get(account.credentials_ref);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.webhook_token === "string" ? parsed.webhook_token : "";
  } catch {
    return "";
  }
}

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let n = 0;
  for (let i = 0; i < x.length; i++) n |= x[i] ^ y[i];
  return n === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(req.url);
  const accountId = url.searchParams.get("account") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !token) return json({ error: "unauthorized" }, 401);

  try {
    const { data: account, error } = await db
      .from("crm_channel_accounts")
      .select("id,user_id,provider,channel,status,credentials_ref")
      .eq("id", accountId)
      .maybeSingle<Account>();
    if (error) throw error;
    const expected = account ? await webhookToken(account) : "";
    if (!account || account.provider !== "infobip" || !expected || !safeEqual(token, expected)) {
      return json({ error: "unauthorized" }, 401);
    }
    if (account.status !== "active") return json({ ok: true, ignored: true, reason: "channel_account_inactive" });

        const payload: unknown = await req.json().catch(() => null);
    const events = parseInfobipWebhook(payload);

    if (accountId === "9d8218c3-0eee-440c-bd73-43f9ed8d8cf1" && events.length === 0) {
      const root = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;
      const entries = Array.isArray(root?.results) ? root.results : [];
      const first = entries[0] && typeof entries[0] === "object" && !Array.isArray(entries[0])
        ? entries[0] as Record<string, unknown>
        : null;
      const message = first?.message && typeof first.message === "object" && !Array.isArray(first.message)
        ? first.message as Record<string, unknown>
        : null;

      console.log("infobip_diagnostic", {
        root_type: Array.isArray(payload) ? "array" : typeof payload,
        has_results_array: Array.isArray(root?.results),
        results_count: entries.length,
        has_sender: typeof first?.sender === "string",
        has_to: typeof first?.to === "string",
        has_text: typeof first?.text === "string",
        content_type: first?.content === null ? "null" : typeof first?.content,
        has_content_text: !!first?.content
          && typeof first.content === "object"
          && typeof (first.content as Record<string, unknown>).text === "string",
        has_message_id: typeof first?.messageId === "string",
        has_from: typeof first?.from === "string",
        has_message_object: !!message,
        has_message_text: typeof message?.text === "string",
        has_message_caption: typeof message?.caption === "string",
        has_status_object: !!first?.status && typeof first.status === "object",
        has_seen_at: !!first?.seenAt,
        recognized_events: events.length,
      });
    }
    const results: unknown[] = [];
    for (const event of events) {
      if (event.kind === "message") {
        const r = await db.rpc("crm_ingest_channel_message", {
          p_user_id: account.user_id,
          p_channel: "whatsapp",
          p_channel_account_id: account.id,
          p_external_user_id: event.from,
          p_body: event.text,
          p_external_message_id: event.messageId,
          p_phone_e164: "+" + event.from,
          p_email: null,
          p_display_name: event.name,
          p_metadata: { provider: "infobip", message_type: event.type, to: event.to },
        });
        if (r.error) throw r.error;
        results.push({ type: "message", data: r.data });
      } else {
        const r = await db.rpc("crm_record_channel_delivery_status", {
          p_channel_account_id: account.id,
          p_external_message_id: event.messageId,
          p_status: event.status,
          p_provider_event: { provider: "infobip", error: event.error },
        });
        if (r.error) throw r.error;
        results.push({ type: "delivery", data: r.data });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    console.error("infobip_webhook.failed", { account: accountId, error: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: "infobip_webhook_processing_failed" }, 500);
  }
});
