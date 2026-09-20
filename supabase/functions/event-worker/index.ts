import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
let serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!serviceRoleKey && secretKeysRaw) {
  try { serviceRoleKey = JSON.parse(secretKeysRaw)?.default ?? ""; } catch { serviceRoleKey = ""; }
}
const envInternalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function resolveInternalSecret() {
  if (envInternalSecret) return envInternalSecret;
  const { data, error } = await db.rpc("get_althea_internal_secret");
  if (error || typeof data !== "string" || !data) return "";
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const internalSecret = await resolveInternalSecret();
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) return json({ error: "unauthorized" }, 401);
  const requestedLimit = Number(req.headers.get("x-batch-size") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  try {
    const now = new Date().toISOString();
    const retryableStatuses = ["pending", "failed", "retry", "received"];
    const { data: events, error } = await db.from("integration_events").select("id,user_id,organization_id,funnel_id,event_type,external_id,status,payload,event_key,processed_at,error_message,retry_count,next_retry_at,claimed_at,claim_attempt").in("status", retryableStatuses).or(`next_retry_at.is.null,next_retry_at.lte.${now}`).order("created_at", { ascending: true }).limit(limit);
    if (error) throw error;
    let processed = 0, failed = 0;
    for (const event of events ?? []) {
      let retryCount = Number(event.retry_count ?? 0) + 1;
      try {
        const claim = await db.rpc("server_claim_integration_event_worker_v1", { p_event_id: event.id });
        if (claim.error) throw claim.error;
        if (claim.data === null || claim.data === undefined) continue;
        retryCount = Number(claim.data);
        const response = await fetch(`${supabaseUrl}/functions/v1/automation-engine-v2`, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": internalSecret }, body: JSON.stringify({ event_id: event.id, event_type: event.event_type, user_id: event.user_id, organization_id: event.organization_id, funnel_id: event.funnel_id, external_id: event.external_id, payload: event.payload ?? {} }) });
        if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`automation_engine_${response.status}${detail ? `:${detail.slice(0, 300)}` : ""}`); }
        const processedEvent = await db.rpc("mark_integration_event_processed", { p_event_id: event.id, p_status: "processed", p_error: null });
        if (processedEvent.error) throw processedEvent.error;
        processed++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        const failure = await db.rpc("server_record_integration_event_failure_v1", {
          p_event_id: event.id,
          p_error: message,
          p_max_retries: 5,
          p_max_delay_seconds: 300,
        });
        if (failure.error) console.error("event_failure_transition_failed", failure.error);
        const failureState = failure.data && typeof failure.data === "object" && !Array.isArray(failure.data)
          ? failure.data as Record<string, unknown>
          : {};
        const terminal = failureState.status === "dead_letter";
        if (terminal) await db.from("event_dead_letters").insert({ id: crypto.randomUUID(), user_id: event.user_id, event_id: event.id, event_type: event.event_type, reason: message, attempts: retryCount, payload: event.payload ?? {}, first_failed_at: new Date().toISOString(), last_failed_at: new Date().toISOString(), created_at: new Date().toISOString() });
      }
    }
    return json({ ok: true, scanned: events?.length ?? 0, processed, failed });
  } catch (err) { return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500); }
});