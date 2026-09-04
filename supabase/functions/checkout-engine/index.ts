import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  return Response.json(
    { ok: false, error: "function_retired", replacement: "checkout-engine-v2" },
    { status: 410 },
  );
});
