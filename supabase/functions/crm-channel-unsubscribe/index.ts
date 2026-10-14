import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyUnsubscribe } from "../_shared/remarketing.ts";

// GET shows a confirmation button (link scanners must not unsubscribe anyone);
// POST records the opt-out — the form and mail clients' one-click (RFC 8058) both post here.

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const page = (title: string, content: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#111}button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:1px solid #111;background:#111;color:#fff;cursor:pointer}</style>` +
      `</head><body><h1>${title}</h1>${content}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const payload = await verifyUnsubscribe(Deno.env.get("CRM_UNSUBSCRIBE_SECRET") ?? "", token);
  if (!payload || payload.c !== "email") return page("Link inválido", "<p>Este link de descadastro não é válido.</p>", 400);

  if (req.method === "GET") {
    return page(
      "Cancelar e-mails",
      `<p>Você não vai mais receber nossos e-mails neste endereço.</p><form method="post"><button type="submit">Confirmar descadastro</button></form>`,
    );
  }
  if (req.method !== "POST") return page("Método não permitido", "", 405);

  const { error } = await db.rpc("crm_channel_record_consent", {
    p_organization_id: payload.o,
    p_channel: "email",
    p_address: payload.a,
    p_status: "opted_out",
    p_source: "email_unsubscribe",
  });
  if (error) {
    console.error("unsubscribe.failed", { code: error.code });
    return page("Tente novamente", "<p>Não conseguimos registrar seu pedido agora.</p>", 500);
  }
  return page("Pronto", "<p>Você não vai mais receber estes e-mails.</p>");
});
