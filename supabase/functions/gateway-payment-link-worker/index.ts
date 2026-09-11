import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const expected = Deno.env.get("ALTHEA_INTERNAL_SECRET") ?? "";
  const supplied = req.headers.get("x-althea-internal-secret") ?? "";
  if (!expected || supplied !== expected) return json({ ok: false, error: "forbidden" }, 403);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return json({ ok: false, error: "server_configuration_error" }, 500);
  const db = createClient(url, service, { auth: { persistSession: false } });
  let body: Json = {};
  try {
    const parsed = await req.json().catch(() => ({}));
    if (isObject(parsed)) body = parsed;
  } catch {}
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 10) || 10));
  const workerId = `gateway-payment-link-worker:${crypto.randomUUID()}`;
  const claimed = await db.rpc("claim_gateway_payment_link_execution", { p_worker_id: workerId, p_limit: limit });
  if (claimed.error) return json({ ok: false, error: "queue_claim_failed", detail: claimed.error.message }, 500);

  const results: Json[] = [];
  for (const command of (Array.isArray(claimed.data) ? claimed.data : []) as Json[]) {
    const commandId = text(command.id);
    const paymentLinkId = text(command.payment_link_id);
    const gatewayId = text(command.gateway_id);
    const userId = text(command.user_id);
    const idempotencyKey = text(command.idempotency_key);
    const payload = isObject(command.request_payload) ? command.request_payload : {};
    try {
      if (!commandId || !paymentLinkId || !gatewayId || !userId || !idempotencyKey) throw new Error("invalid_execution_command");

      const link = await db.from("gateway_payment_links").select("id,user_id,funnel_id,checkout_id,transaction_id,gateway_id,provider,link_type,amount,currency,status,external_id,payment_url,metadata").eq("id", paymentLinkId).eq("user_id", userId).maybeSingle();
      if (link.error || !link.data) throw new Error("payment_link_not_found");
      if (["active", "paid"].includes(String(link.data.status))) {
        const done = await db.rpc("complete_gateway_payment_link_execution", { p_command_id: commandId, p_result_payload: { reused: true, payment_link_id: paymentLinkId, status: link.data.status, external_id: link.data.external_id ?? null, payment_url: link.data.payment_url ?? null } });
        if (done.error) throw done.error;
        results.push({ id: commandId, status: "completed", reused: true });
        continue;
      }

      const gateway = await db.from("gateways").select("id,user_id,provider,environment,status").eq("id", gatewayId).eq("user_id", userId).maybeSingle();
      if (gateway.error || !gateway.data) throw new Error("gateway_not_found");
      if (!["connected", "degraded"].includes(String(gateway.data.status).toLowerCase())) throw new Error("gateway_not_operational");

      const response = await fetch(`${url}/functions/v1/gateway-provider-adapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Althea-Internal-Secret": expected, "X-Althea-Gateway-Id": gatewayId, "X-Althea-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          operation: "create_payment_link",
          provider: String(gateway.data.provider).toLowerCase(),
          environment: String(gateway.data.environment ?? "production"),
          gateway_id: gatewayId,
          idempotency_key: idempotencyKey,
          amount: Number(link.data.amount),
          currency: String(link.data.currency).toUpperCase(),
          link_type: String(link.data.link_type),
          metadata: { ...((isObject(link.data.metadata) ? link.data.metadata : {})), ...payload, payment_link_id: paymentLinkId, transaction_id: link.data.transaction_id },
        }),
      });
      const provider = await response.json().catch(() => ({}));
      if (!response.ok || !isObject(provider) || provider.ok !== true) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        const failed = await db.rpc("fail_gateway_payment_link_execution", {
          p_command_id: commandId,
          p_error_code: text(isObject(provider) ? provider.error : "") || `provider_http_${response.status}`,
          p_error_message: text(isObject(provider) ? (provider.detail ?? provider.message ?? provider.error) : "") || "provider_payment_link_creation_failed",
          p_retryable: retryable,
          p_retry_seconds: response.status === 429 ? 60 : 30,
        });
        results.push({ id: commandId, status: failed.error ? "failed" : String(failed.data?.status ?? (retryable ? "queued" : "failed")), error: text(isObject(provider) ? provider.error : "") || `provider_http_${response.status}` });
        continue;
      }

      const externalId = text(provider.external_id ?? provider.id);
      const paymentUrl = text(provider.payment_url ?? provider.url ?? provider.init_point);
      if (!externalId || !paymentUrl) throw new Error("provider_payment_link_response_incomplete");

      const updated = await db.from("gateway_payment_links").update({
        status: "active",
        external_id: externalId,
        payment_url: paymentUrl,
        metadata: { ...((isObject(link.data.metadata) ? link.data.metadata : {})), ...payload, provider_result: { external_id: externalId, provider: String(gateway.data.provider).toLowerCase() } },
        updated_at: new Date().toISOString(),
      }).eq("id", paymentLinkId).eq("user_id", userId).eq("status", "pending").select("id,status,external_id,payment_url").maybeSingle();
      if (updated.error) throw new Error(`payment_link_persistence_failed:${updated.error.message}`);
      if (!updated.data) {
        const current = await db.from("gateway_payment_links").select("id,status,external_id,payment_url").eq("id", paymentLinkId).eq("user_id", userId).maybeSingle();
        if (current.error || !current.data || String(current.data.status) !== "active") throw new Error("payment_link_persistence_conflict");
      }

      const done = await db.rpc("complete_gateway_payment_link_execution", { p_command_id: commandId, p_result_payload: { payment_link_id: paymentLinkId, external_id: externalId, payment_url: paymentUrl, provider: String(gateway.data.provider).toLowerCase(), status: "active" } });
      if (done.error) throw done.error;
      results.push({ id: commandId, status: "completed", payment_link_id: paymentLinkId, external_id: externalId, payment_url: paymentUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /gateway_not_operational|payment_link_persistence|fetch|timeout|temporar/i.test(message);
      const failed = await db.rpc("fail_gateway_payment_link_execution", { p_command_id: commandId, p_error_code: "EXECUTION_FAILED", p_error_message: message, p_retryable: retryable, p_retry_seconds: 30 });
      results.push({ id: commandId, status: failed.error ? "failed" : String(failed.data?.status ?? (retryable ? "queued" : "failed")), error: message });
    }
  }
  return json({ ok: true, worker_id: workerId, claimed: Array.isArray(claimed.data) ? claimed.data.length : 0, results });
});
