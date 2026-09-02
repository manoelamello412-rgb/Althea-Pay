import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { simulateSandboxPayment } from "../_shared/gateway-sandbox-sim.ts";

// Sandbox-only idempotency. Production payment flows use the durable
// idempotency infrastructure elsewhere in the platform.
const idempotencyStore = new Map<string, unknown>();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const rawKey =
      req.headers.get("idempotency-key") ??
      req.headers.get("Idempotency-Key");
    const idempotencyKey = rawKey?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 200) {
      return json({ error: "idempotency_key_too_long" }, 400);
    }

    const parsed: unknown = await req.json().catch(() => null);
    if (!isRecord(parsed)) return json({ error: "invalid_json" }, 400);

    if (idempotencyKey) {
      const seen = idempotencyStore.get(idempotencyKey);
      if (seen !== undefined) return json({ duplicate: true, result: seen });
    }

    const result = simulateSandboxPayment(parsed);

    if (idempotencyKey) idempotencyStore.set(idempotencyKey, result);

    console.log("sandbox.payment", { result });
    return json({ result });
  } catch (err) {
    console.error("sandbox.error", err);
    return json({
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
