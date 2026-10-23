// Infobip WhatsApp: request building and webhook parsing. Pure (no Deno globals) so vitest can import it.

type Json = Record<string, unknown>;

// templateData without body: header, buttons, carousel, limitedTimeOffer… exactly as Infobip's send API takes them.
export type InfobipTemplate = { name: string; language: string; placeholders?: string[]; data?: Json };

export type InfobipSend = {
  baseUrl: string;
  apiKey: string;
  from: string;
  to: string;
  messageId: string;
  body: string;
  template?: InfobipTemplate | null;
  notifyUrl?: string | null;
};

export type InfobipEvent =
  | { kind: "message"; from: string; to: string; messageId: string; text: string; name: string | null; type: string }
  | { kind: "status"; messageId: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null };

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());

export const digits = (value: string) => value.replace(/\D/g, "");

export function infobipBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  const url = new URL(value.startsWith("http") ? value : "https://" + value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".api.infobip.com")) throw new Error("infobip_base_url_invalid");
  return url.origin;
}

// Outside the 24h customer-service window WhatsApp only accepts approved templates.
export function infobipRequest(input: InfobipSend): { url: string; init: RequestInit } {
  const base = infobipBaseUrl(input.baseUrl);
  const from = digits(input.from);
  const to = digits(input.to);
  if (!from || !to) throw new Error("whatsapp_destination_missing");
  const headers = { authorization: "App " + input.apiKey, "content-type": "application/json", accept: "application/json" };
  const notify = input.notifyUrl ? { notifyUrl: input.notifyUrl } : {};

  if (input.template) {
    const { name, language, placeholders = [], data = {} } = input.template;
    if (!name || !language) throw new Error("whatsapp_template_invalid");
    return {
      url: base + "/whatsapp/1/message/template",
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [{
            from,
            to,
            messageId: input.messageId,
            content: { templateName: name, templateData: { body: { placeholders: placeholders.map(String) }, ...data }, language },
            ...notify,
          }],
        }),
      },
    };
  }

  return {
    url: base + "/whatsapp/1/message/text",
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to, messageId: input.messageId, content: { text: input.body }, ...notify }),
    },
  };
}

// ---- Approved template -> send payload -------------------------------------------------------------------
// Infobip rejects a template send whose parameters don't match the approved structure (7008). The structure
// (GET /whatsapp/2/senders/{sender}/templates) carries an approved example for every variable part, so a complete,
// valid templateData can be built for any template; values configured on the Althea template override it.
// Field names follow Infobip's OpenAPI (infobip-api-java-client WhatsAppTemplate*Content / WhatsApp*ApiData).
export function infobipTemplatesUrl(baseUrl: string, sender: string): string {
  return infobipBaseUrl(baseUrl) + "/whatsapp/2/senders/" + digits(sender) + "/templates";
}

export function findTemplate(payload: unknown, name: string, language: string): Json | null {
  const templates = isObject(payload) && Array.isArray(payload.templates) ? payload.templates.filter(isObject) : [];
  return templates.find((t) => str(t.name) === name && str(t.language) === language) ?? templates.find((t) => str(t.name) === name) ?? null;
}

const MEDIA = ["IMAGE", "VIDEO", "DOCUMENT", "GIF"];
const fileName = (url: string) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || "documento"; } catch { return "documento"; }
};
const media = (type: string, url: string) => (type === "DOCUMENT" ? { type, mediaUrl: url, filename: fileName(url) } : { type, mediaUrl: url });

function headerFromStructure(header: unknown): Json | null {
  if (!isObject(header)) return null;
  const format = str(header.format).toUpperCase();
  if (MEDIA.includes(format) && str(header.example)) return media(format, str(header.example));
  if (format === "TEXT" && /\{\{\s*1\s*\}\}/.test(str(header.text))) return { type: "TEXT", placeholder: str(header.example) };
  return null; // static text header needs nothing; LOCATION has no example and must be configured
}

// Only buttons with a send-time part get an entry, in template order (PHONE_NUMBER and static URLs have none).
function buttonsFromStructure(buttons: unknown): Json[] {
  return (Array.isArray(buttons) ? buttons.filter(isObject) : []).flatMap((b): Json[] => {
    const type = str(b.type).toUpperCase();
    if (type === "QUICK_REPLY") return [{ type, parameter: str(b.text) }];
    if (type === "URL") return /\{\{\s*1\s*\}\}/.test(str(b.url)) ? [{ type, parameter: str(b.example) }] : [];
    if (type === "COPY_CODE") return [{ type, parameter: str(b.example) }];
    if (type === "FLOW" || type === "VOICE_CALL" || type === "CATALOG" || type === "MULTI_PRODUCT") return [{ type }];
    return [];
  });
}

export function templateDataFromStructure(template: Json | null, placeholders: string[], now = new Date()): Json {
  const structure = template && isObject(template.structure) ? template.structure : null;
  if (!structure) return {};
  // Authentication: the code goes in the body and again as the URL button parameter (Infobip API convention).
  if (str(template?.category).toUpperCase() === "AUTHENTICATION") return { buttons: [{ type: "URL", parameter: placeholders[0] ?? "" }] };
  const data: Json = {};
  const header = headerFromStructure(structure.header);
  if (header) data.header = header;
  const buttons = buttonsFromStructure(structure.buttons);
  if (buttons.length) data.buttons = buttons;
  const cards = isObject(structure.carousel) && Array.isArray(structure.carousel.cards) ? structure.carousel.cards.filter(isObject) : [];
  if (cards.length) {
    data.carousel = {
      cards: cards.map((card) => {
        const examples = isObject(card.body) && Array.isArray(card.body.examples) ? card.body.examples.map(str) : [];
        const out: Json = { body: { placeholders: examples } };
        const cardHeader = headerFromStructure(card.header);
        if (cardHeader) out.header = cardHeader;
        const cardButtons = buttonsFromStructure(card.buttons);
        if (cardButtons.length) out.buttons = cardButtons;
        return out;
      }),
    };
  }
  // ponytail: offers with expiration default to 24h from send; configure limitedTimeOffer.expirationTime to change it.
  if (isObject(structure.limitedTimeOffer) && structure.limitedTimeOffer.hasExpiration) {
    data.limitedTimeOffer = { expirationTime: new Date(now.getTime() + 86_400_000).toISOString() };
  }
  return data;
}

// Values configured on the Althea template (crm_message_templates): header type/value, ordered buttons and a
// free-form templateData JSON for anything else (carousel, limitedTimeOffer, orderStatus…). null fields = automatic.
const BUTTON_FIELD: Record<string, string> = { FLOW: "flowToken", CATALOG: "thumbnailProductRetailerId", MULTI_PRODUCT: "thumbnailProductRetailerId", VOICE_CALL: "callContextPayload" };
export function configuredTemplateData(row: { whatsapp_header_type?: unknown; whatsapp_header_url?: unknown; whatsapp_buttons?: unknown; whatsapp_template_data?: unknown } | null): Json {
  if (!row) return {};
  const data: Json = isObject(row.whatsapp_template_data) ? { ...row.whatsapp_template_data } : {};
  const type = str(row.whatsapp_header_type).toUpperCase();
  const value = str(row.whatsapp_header_url);
  if (type && value && !data.header) {
    if (MEDIA.includes(type)) data.header = media(type, value);
    else if (type === "TEXT") data.header = { type, placeholder: value };
    else if (type === "LOCATION") {
      const [latitude, longitude] = value.split(",").map((n) => Number(n.trim()));
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) data.header = { type, latitude, longitude };
    }
  }
  if (Array.isArray(row.whatsapp_buttons) && row.whatsapp_buttons.length && !data.buttons) {
    data.buttons = row.whatsapp_buttons.filter(isObject).map((b) => {
      const kind = str(b.type).toUpperCase();
      const parameter = str(b.parameter);
      const field = BUTTON_FIELD[kind] ?? "parameter";
      return parameter ? { type: kind, [field]: parameter } : { type: kind };
    });
  }
  return data;
}

// "{{n}}" anywhere in configured/auto values -> the template's n-th variable (nome, link do checkout…).
export function resolvePlaceholders<T>(value: T, placeholders: string[]): T {
  if (typeof value === "string") return value.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => placeholders[Number(n) - 1] ?? "") as T;
  if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, placeholders)) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePlaceholders(v, placeholders)])) as T;
  return value;
}

export function buildTemplateData(approved: Json | null, configured: Json, placeholders: string[], now = new Date()): Json {
  return resolvePlaceholders({ ...templateDataFromStructure(approved, placeholders, now), ...configured }, placeholders);
}

export function infobipMessageId(payload: unknown): string {
  if (!isObject(payload)) return "";
  const first = Array.isArray(payload.messages) && isObject(payload.messages[0]) ? payload.messages[0] : payload;
  return str(first.messageId);
}

export function parseTemplate(metadata: unknown): InfobipTemplate | null {
  const raw = isObject(metadata) ? metadata.whatsapp_template : null;
  if (!isObject(raw)) return null;
  const placeholders = Array.isArray(raw.placeholders) ? raw.placeholders.map(str) : [];
  return { name: str(raw.name), language: str(raw.language) || "pt_BR", placeholders };
}

const statusByGroup: Record<string, "sent" | "delivered" | "failed"> = {
  PENDING: "sent",
  DELIVERED: "delivered",
  UNDELIVERABLE: "failed",
  EXPIRED: "failed",
  REJECTED: "failed",
};

// One webhook URL receives inbound messages, delivery reports and seen reports.
export function parseInfobipWebhook(payload: unknown): InfobipEvent[] {
  const results = isObject(payload) && Array.isArray(payload.results) ? payload.results : [];
  const events: InfobipEvent[] = [];
  for (const item of results) {
    if (!isObject(item)) continue;
    const messageId = str(item.messageId);
    if (!messageId) continue;

    if (isObject(item.message)) {
      const message = item.message;
      const text = str(message.text) || str(message.caption) || str(isObject(message.button) ? message.button.text : "");
      const from = digits(str(item.from));
      if (!text || !from) continue;
      events.push({
        kind: "message",
        from,
        to: digits(str(item.to)),
        messageId,
        text,
        name: str(isObject(item.contact) ? item.contact.name : "") || null,
        type: str(message.type).toLowerCase() || "text",
      });
    } else if (item.seenAt) {
      events.push({ kind: "status", messageId, status: "read", error: null });
    } else if (isObject(item.status)) {
      const status = statusByGroup[str(item.status.groupName).toUpperCase()];
      if (!status) continue;
      const error = isObject(item.error) && str(item.error.name) !== "NO_ERROR" ? str(item.error.name) || null : null;
      events.push({ kind: "status", messageId, status, error: status === "failed" ? error ?? str(item.status.name) : null });
    }
  }
  return events;
}
