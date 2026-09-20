import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Content-Type": "application/json" } });
const metadata = (gateway: any) => gateway?.data && typeof gateway.data === "object" && !Array.isArray(gateway.data) ? gateway.data : {};
const normalizeProvider = (gateway: any) => { const data = metadata(gateway); return String(data.provider ?? data.gateway_name ?? data.name ?? gateway.id ?? "unknown").trim().toLowerCase(); };
const statusTarget = (status: string) => { if (["chargeback", "charged_back"].includes(status)) return "chargeback"; if (["refunded", "refund", "reversed"].includes(status)) return "refunded"; if (["paid", "approved", "completed", "success"].includes(status)) return "approved"; return null; };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const internal = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
  if (!internal || req.headers.get("x-internal-secret") !== internal) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "server_configuration_error" }, 500);
  const db = createClient(url, service);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const start = body.period_start ? new Date(body.period_start).toISOString() : new Date(Date.now() - 86_400_000).toISOString();
  const end = body.period_end ? new Date(body.period_end).toISOString() : new Date().toISOString();
  if (new Date(end) < new Date(start)) return json({ error: "invalid_period" }, 400);

  const { data: gateways, error: gatewayError } = await db.from("gateways").select("id,user_id,data");
  if (gatewayError) return json({ error: "gateway_lookup_failed" }, 500);
  let processed = 0, updated = 0, failed = 0, missingGateway = 0, duplicateRemote = 0;
  const runs: string[] = [];

  for (const gateway of gateways ?? []) {
    const provider = normalizeProvider(gateway), key = provider.replace(/[^a-z0-9]/gi, "_").toUpperCase();
    const configured = Deno.env.get(`GATEWAY_RECONCILIATION_URL_${key}`);
    const base = Deno.env.get("GATEWAY_RECONCILIATION_BASE_URL")?.replace(/\/$/, "");
    const endpoint = configured ?? (base ? `${base}/reconciliation/${encodeURIComponent(provider)}` : null);
    if (!endpoint) { failed++; continue; }

    const { data: run, error: runError } = await db.from("reconciliation_runs").insert({ user_id: gateway.user_id, gateway_id: gateway.id, period_start: start, period_end: end, status: "running", source_type: "gateway_api", source_reference: provider, started_at: new Date().toISOString() }).select("id").single();
    if (runError || !run) { failed++; continue; }
    runs.push(run.id);

    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-althea-gateway-id": gateway.id, "x-althea-user-id": gateway.user_id, "x-period-start": start, "x-period-end": end }, body: JSON.stringify({ gateway_id: gateway.id, user_id: gateway.user_id, period_start: start, period_end: end }) });
      if (!response.ok) throw new Error(`gateway_http_${response.status}`);
      const payload: any = await response.json();
      const rows = Array.isArray(payload?.transactions) ? payload.transactions : Array.isArray(payload) ? payload : [];
      const seen = new Set<string>();
      const remoteIds = new Set<string>();
      let matched = 0, mismatch = 0, grossExpected = 0, grossReported = 0;

      for (const row of rows) {
        processed++;
        const external = String(row.external_transaction_id ?? row.transaction_id ?? row.external_id ?? "").trim();
        const reported = Number(row.amount ?? row.gross ?? 0), remoteStatus = String(row.status ?? "").trim().toLowerCase();
        if (external) remoteIds.add(external);
        if (!external) {
          mismatch++;
          await db.from("reconciliation_items").insert({ user_id: gateway.user_id, run_id: run.id, external_transaction_id: null, status: "missing_internal", reported_amount: reported, discrepancy_amount: reported, mismatch_reason: "missing_external_transaction_id", gateway_payload: row });
          continue;
        }
        if (seen.has(external)) {
          duplicateRemote++;
          await db.from("reconciliation_items").insert({ user_id: gateway.user_id, run_id: run.id, external_transaction_id: external, status: "duplicate", reported_amount: reported, discrepancy_amount: 0, mismatch_reason: "duplicate_gateway_record", gateway_payload: row });
          continue;
        }
        seen.add(external);
        const { data: tx, error: txError } = await db.from("gateway_transactions").select("id,amount,external_id,status,created_at").eq("user_id", gateway.user_id).eq("gateway_id", gateway.id).eq("external_id", external).maybeSingle();
        if (txError) throw txError;
        if (!tx) {
          mismatch++;
          await db.from("reconciliation_items").insert({ user_id: gateway.user_id, run_id: run.id, external_transaction_id: external, status: "missing_internal", reported_amount: reported, discrepancy_amount: reported, mismatch_reason: "transaction_not_found", gateway_payload: row });
          continue;
        }
        const expected = Number(tx.amount), gross = Number.isFinite(reported) ? reported : 0, discrepancy = Math.round((expected - gross) * 100) / 100, itemStatus = Math.abs(discrepancy) < 0.01 ? "matched" : "amount_mismatch";
        grossExpected += expected; grossReported += gross;
        if (itemStatus === "matched") matched++; else mismatch++;
        await db.from("reconciliation_items").insert({ user_id: gateway.user_id, run_id: run.id, transaction_id: tx.id, external_transaction_id: external, status: itemStatus, expected_amount: expected, reported_amount: gross, discrepancy_amount: discrepancy, mismatch_reason: itemStatus === "matched" ? null : "amount_difference", gateway_payload: row });
        const target = statusTarget(remoteStatus);
        if (!target || (target === "approved" && tx.status === "approved")) continue;
        const { error: transitionError } = await db.rpc("transition_gateway_transaction_status", { p_transaction_id: tx.id, p_user_id: gateway.user_id, p_next_status: target, p_failure_code: null, p_external_id: external });
        if (transitionError) throw transitionError;
        if (target === "refunded" || target === "chargeback") await db.from("sales").update({ status: target, data: row }).eq("user_id", gateway.user_id).eq("transaction_id", tx.id);
        updated++;
      }

      const { data: internalRows, error: internalError } = await db.from("gateway_transactions").select("id,amount,external_id,status").eq("user_id", gateway.user_id).eq("gateway_id", gateway.id).gte("created_at", start).lte("created_at", end);
      if (internalError) throw internalError;
      for (const tx of internalRows ?? []) {
        const external = String(tx.external_id ?? "").trim();
        if (!external || remoteIds.has(external)) continue;
        missingGateway++;
        mismatch++;
        await db.from("reconciliation_items").insert({ user_id: gateway.user_id, run_id: run.id, transaction_id: tx.id, external_transaction_id: external || null, status: "missing_gateway", expected_amount: Number(tx.amount), reported_amount: 0, discrepancy_amount: Number(tx.amount), mismatch_reason: "internal_transaction_absent_from_gateway_report", gateway_payload: { status: tx.status } });
      }

      await db.from("reconciliation_runs").update({ status: "completed", matched_count: matched, mismatch_count: mismatch, gross_expected: grossExpected, gross_reported: grossReported, discrepancy_amount: Math.round((grossExpected - grossReported) * 100) / 100, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id);
    } catch (error) {
      failed++;
      await db.from("reconciliation_runs").update({ status: "failed", error_message: error instanceof Error ? error.message : "reconciliation_failed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id);
    }
  }
  return json({ ok: true, period_start: start, period_end: end, gateways_scanned: (gateways ?? []).length, runs, transactions_processed: processed, records_updated: updated, failed_gateways: failed, missing_gateway_records: missingGateway, duplicate_gateway_records: duplicateRemote });
});
