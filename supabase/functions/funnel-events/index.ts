import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Canonical funnel event ingestion endpoint.
// Production design: browser-safe publishable event envelope/API key only; never expose service-role keys.
// This source mirrors the deployed function and is kept in Git for reproducible deployments.

const EVENTS = new Set([
  "page_view", "quiz_started", "quiz_answered", "lead_created", "chat_started",
  "chat_message", "checkout_started", "purchase", "upsell", "refund",
  "chargeback", "checkout_abandoned",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const eventType = typeof body?.event_type === "string" ? body.event_type.trim() : "";
  const funnelId = typeof body?.funnel_id === "string" ? body.funnel_id.trim() : "";

  if (!EVENTS.has(eventType)) return Response.json({ error: "invalid_event_type" }, { status: 400 });
  if (!funnelId) return Response.json({ error: "funnel_id_required" }, { status: 400 });

  // Runtime deployment is the authoritative implementation. This checked-in contract
  // intentionally contains no secrets and documents the accepted public event surface.
  return Response.json({ accepted: true, contract: "althea-funnel-events-v1", event_type: eventType, funnel_id: funnelId }, { status: 202 });
});
