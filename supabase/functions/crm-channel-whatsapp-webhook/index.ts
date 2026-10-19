import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseBridgeInbound, safeEqual } from "../_shared/whatsapp.ts";

// Inbound WhatsApp messages forwarded by whatsapp-bridge (INBOUND_WEBHOOK_URL points here).
// The bridge authenticates with the shared WHATSAPP_BRIDGE_TOKEN in x-bridge-token.

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const bridgeToken = Deno.env.get("WHATSAPP_BRIDGE_TOKEN") ?? "";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!bridgeToken || !safeEqual(req.headers.get("x-bridge-token") ?? "", bridgeToken)) return json({ error: "unauthorized" }, 401);

  const event = parseBridgeInbound(await req.json().catch(() => null));
  if (!event) return json({ error: "invalid_payload" }, 400);

  try {
    const { data: account, error } = await db
      .from("crm_channel_accounts")
      .select("id,user_id,status")
      .eq("id", event.accountId)
      .eq("channel", "whatsapp")
      .eq("provider", "baileys")
      .maybeSingle();
    if (error) throw error;
    if (!account) return json({ error: "channel_account_not_found" }, 404);
    if (account.status !== "active") return json({ ok: true, ignored: true, reason: "channel_account_inactive" });

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
      p_metadata: { provider: "baileys", message_type: event.type },
    });
    if (r.error) throw r.error;
    return json({ ok: true, data: r.data });
  } catch (e) {
    console.error("whatsapp_webhook.failed", { account: event.accountId, error: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: "whatsapp_webhook_processing_failed" }, 500);
  }
});
