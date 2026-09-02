import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  const requestedLimit = Number(req.headers.get("x-batch-size") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);

  try {
    const now = new Date().toISOString();
    const { data: events, error } = await db
      .from("integration_events")
      .select("id,user_id,funnel_id,event_type,external_id,status,payload,event_key,processed_at,error_message,retry_count,next_retry_at,claimed_at,claim_attempt")
      .in("status", ["pending", "failed"])
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;

    let processed = 0;
    let failed = 0;

    for (const event of events ?? []) {
      const retryCount = Number(event.retry_count ?? 0) + 1;

      try {
        const { error: claimError } = await db
          .from("integration_events")
          .update({
            status: "processing",
            retry_count: retryCount,
            claimed_at: new Date().toISOString(),
            claim_attempt: Number(event.claim_attempt ?? 0) + 1,
            error_message: null,
          })
          .eq("id", event.id)
          .in("status", ["pending", "failed"]);

        if (claimError) throw claimError;

        const automationUrl = `${supabaseUrl}/functions/v1/automation-engine-v2`;
        const response = await fetch(automationUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": internalSecret,
          },
          body: JSON.stringify({
            event_id: event.id,
            event_type: event.event_type,
            user_id: event.user_id,
            funnel_id: event.funnel_id,
            external_id: event.external_id,
            payload: event.payload ?? {},
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`automation_engine_${response.status}${detail ? `:${detail.slice(0, 300)}` : ""}`);
        }

        const { error: processedError } = await db
          .from("integration_events")
          .update({
            status: "processed",
            processed_at: new Date().toISOString(),
            next_retry_at: null,
            claimed_at: null,
            error_message: null,
          })
          .eq("id", event.id);

        if (processedError) throw processedError;
        processed++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        const terminal = retryCount >= 5;
        const nextRetryAt = terminal
          ? null
          : new Date(Date.now() + Math.min(300_000, 2 ** retryCount * 1000)).toISOString();

        await db
          .from("integration_events")
          .update({
            status: terminal ? "dead_letter" : "failed",
            retry_count: retryCount,
            error_message: message,
            next_retry_at: nextRetryAt,
            claimed_at: null,
          })
          .eq("id", event.id);

        if (terminal) {
          await db.from("event_dead_letters").insert({
            id: crypto.randomUUID(),
            user_id: event.user_id,
            event_id: event.id,
            event_type: event.event_type,
            reason: message,
            attempts: retryCount,
            payload: event.payload ?? {},
            first_failed_at: new Date().toISOString(),
            last_failed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    return json({
      ok: true,
      scanned: events?.length ?? 0,
      processed,
      failed,
    });
  } catch (err) {
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
