import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const internalSecret = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!internalSecret || req.headers.get("x-internal-secret") !== internalSecret) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 50);
    const recovered = await db.rpc("recover_stale_core_jobs", { p_stale_minutes: 10 });
    if (recovered.error) throw recovered.error;
    const workerId = `core-worker:${crypto.randomUUID()}`;
    const claimed = await db.rpc("claim_core_jobs", { p_worker_id: workerId, p_limit: limit });
    if (claimed.error) throw claimed.error;
    const jobs = Array.isArray(claimed.data) ? claimed.data : [];
    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs) {
      try {
        if (job.job_type !== "integration_event_retry") throw new Error(`unsupported_job_type:${job.job_type}`);
        const eventId = String(job.payload?.event_id ?? "");
        if (!eventId) throw new Error("missing_event_id");
        const response = await fetch(`${supabaseUrl}/functions/v1/integration-event-processor`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-internal-secret": internalSecret },
          body: JSON.stringify({ event_id: eventId }),
        });
        if (!response.ok) throw new Error(`processor_http_${response.status}`);
        const done = await db.rpc("finish_core_job", { p_job_id: job.id, p_success: true });
        if (done.error) throw done.error;
        results.push({ id: job.id, status: "completed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const done = await db.rpc("finish_core_job", { p_job_id: job.id, p_success: false, p_error: message });
        results.push({ id: job.id, status: done.error ? "failed" : String(done.data?.status ?? "retry"), error: message });
      }
    }
    return json({ ok: true, worker_id: workerId, recovered: Number(recovered.data ?? 0), claimed: jobs.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
