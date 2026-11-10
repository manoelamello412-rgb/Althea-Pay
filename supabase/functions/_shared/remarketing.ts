// Template rendering and signed e-mail unsubscribe tokens. Pure (Web Crypto only) so vitest can import it.
// Rendering mirrors private.crm_render_template: {{n}} -> context[variables[n-1]].

export type TemplateRow = {
  body: string;
  subject: string | null;
  variables: string[];
  whatsapp_template_name: string | null;
  language: string;
  email_header_url?: string | null;
  email_button_text?: string | null;
  email_button_url?: string | null;
};

export function renderTemplate(body: string, variables: string[], context: Record<string, string>): string {
  return variables.reduce((text, key, i) => text.split(`{{${i + 1}}}`).join(context[key] ?? ""), body);
}

// Outbox metadata the dispatcher understands (whatsapp_template, email_subject, email_header_url, email_button).
export function templateMessage(template: TemplateRow, context: Record<string, string>) {
  const placeholders = template.variables.map((key) => context[key] ?? "");
  const fill = (value: string) => renderNamed(renderTemplate(value, template.variables, context), context).trim();
  const button = template.email_button_text && template.email_button_url ? safeButton(template.email_button_text, fill(template.email_button_url)) : null;
  return {
    body: renderTemplate(template.body, template.variables, context),
    metadata: {
      ...(template.subject ? { email_subject: renderTemplate(template.subject, template.variables, context) } : {}),
      ...(template.email_header_url ? { email_header_url: template.email_header_url } : {}),
      ...(button ? { email_button: button } : {}),
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

// {chave} placeholders, same keys as private.crm_render_named.
export function renderNamed(body: string, context: Record<string, string>): string {
  return ["nome", "primeiro_nome", "email", "telefone", "link", "valor", "produto"]
    .reduce((text, key) => text.split(`{${key}}`).join(context[key] ?? ""), body);
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Preenche variáveis em um HTML de e-mail já cadastrado.
 * Preserva as tags do template e escapa os dados do cliente.
 *
 * Compatível com:
 * {nome}, {primeiro_nome}, {email}, {telefone},
 * {link}, {valor}, {produto}
 * e variáveis posicionais {{1}}, {{2}}, ...
 */
export function renderEmailTemplateHtml(
  html: string,
  context: Record<string, string>,
  variables: string[] = [],
): string {
  const supported = [
    "nome",
    "primeiro_nome",
    "email",
    "telefone",
    "link",
    "valor",
    "produto",
  ];

  const replacements = new Map<string, string>();

  for (const key of supported) {
    replacements.set(`{${key}}`, escapeHtml(context[key] ?? ""));
  }

  variables.forEach((key, index) => {
    replacements.set(
      `{{${index + 1}}}`,
      escapeHtml(context[key] ?? ""),
    );
  });

  return html.replace(
    /\{\{\d+\}\}|\{(?:nome|primeiro_nome|email|telefone|link|valor|produto)\}/g,
    (placeholder) => replacements.get(placeholder) ?? "",
  );
}


export type RemarketingRule = {
  channel: "email" | "whatsapp";
  email_subject: string | null;
  body: string;
  button_text: string | null;
  button_url: string | null;
};

export type EmailButton = { text: string; url: string };
const httpUrl = (url: string) => /^https?:\/\/[^\s<>"]+$/i.test(url);
// The button only goes out with an http(s) URL (never javascript:, data:, …).
export function safeButton(text: unknown, url: unknown): EmailButton | null {
  const label = typeof text === "string" ? text.trim() : "";
  const href = typeof url === "string" ? url.trim() : "";
  return label && httpUrl(href) ? { text: label, url: href } : null;
}

// The one e-mail layout: optional header image, the text, an optional button, optional unsubscribe link.
// Everything is escaped: body and button come from templates filled with customer data.
export function emailHtml(body: string, options: { headerUrl?: unknown; button?: EmailButton | null; unsubscribeUrl?: string } = {}) {
  const header = typeof options.headerUrl === "string" && /^https:\/\/[^\s<>"]+$/i.test(options.headerUrl.trim()) ? options.headerUrl.trim() : "";
  const { button, unsubscribeUrl } = options;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">` +
    (header ? `<p style="margin:0 0 20px"><img src="${escapeHtml(header)}" alt="" style="max-width:100%;height:auto;display:block;border:0"></p>` : "") +
    escapeHtml(body).replace(/\n/g, "<br>") +
    (button
      ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#10b981;color:#000;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(button.text)}</a></p>`
      : "") +
    (unsubscribeUrl ? `<p style="margin-top:32px;font-size:12px;color:#888"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888">Não quero mais receber estes e-mails</a></p>` : "") +
    "</div>";
}

// Remarketing rule -> outbox body (+ e-mail subject/HTML with a button).
export function ruleMessage(rule: RemarketingRule, context: Record<string, string>) {
  const body = renderNamed(rule.body, context);
  const button = rule.button_url ? safeButton(rule.button_text, renderNamed(rule.button_url, context)) : null;
  if (rule.channel === "whatsapp") {
    return { body: button ? `${body}\n\n${button.text}: ${button.url}` : body, metadata: {} };
  }
  return {
    body: button ? `${body}\n\n${button.text}: ${button.url}` : body,
    metadata: { email_subject: renderNamed(rule.email_subject ?? "", context), email_html: emailHtml(body, { button }) },
  };
}
