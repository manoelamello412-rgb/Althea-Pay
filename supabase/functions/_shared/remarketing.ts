// Template rendering and signed e-mail unsubscribe tokens. Pure (Web Crypto only) so vitest can import it.
// Rendering mirrors private.crm_render_template: {{n}} -> context[variables[n-1]].

export type TemplateRow = {
  body: string;
  subject: string | null;
  variables: string[];
  whatsapp_template_name: string | null;
  language: string;
};

export function renderTemplate(body: string, variables: string[], context: Record<string, string>): string {
  return variables.reduce((text, key, i) => text.split(`{{${i + 1}}}`).join(context[key] ?? ""), body);
}

// Outbox metadata the dispatcher understands (whatsapp_template, email_subject).
export function templateMessage(template: TemplateRow, context: Record<string, string>) {
  const placeholders = template.variables.map((key) => context[key] ?? "");
  return {
    body: renderTemplate(template.body, template.variables, context),
    metadata: {
      ...(template.subject ? { email_subject: renderTemplate(template.subject, template.variables, context) } : {}),
      ...(template.whatsapp_template_name
        ? { whatsapp_template: { name: template.whatsapp_template_name, language: template.language, placeholders } }
        : {}),
    },
  };
}

export type UnsubscribePayload = { o: string; c: string; a: string };

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function mac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function signUnsubscribe(secret: string, payload: UnsubscribePayload): Promise<string> {
  if (!secret) throw new Error("unsubscribe_secret_missing");
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return body + "." + b64url(await mac(secret, body));
}

export async function verifyUnsubscribe(secret: string, token: string): Promise<UnsubscribePayload | null> {
  const [body, signature] = token.split(".");
  if (!secret || !body || !signature) return null;
  try {
    const expected = await mac(secret, body);
    const given = fromB64url(signature);
    if (given.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
    if (diff !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return typeof payload?.o === "string" && typeof payload?.c === "string" && typeof payload?.a === "string" ? payload : null;
  } catch {
    return null;
  }
}
