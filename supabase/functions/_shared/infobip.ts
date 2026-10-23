// Infobip WhatsApp: request building and webhook parsing. Pure (no Deno globals) so vitest can import it.

type Json = Record<string, unknown>;

export type InfobipHeader = { type: "IMAGE" | "VIDEO" | "DOCUMENT"; url: string };
export type InfobipTemplate = { name: string; language: string; placeholders?: string[]; header?: InfobipHeader | null };

const HEADER_TYPES = ["IMAGE", "VIDEO", "DOCUMENT"];
export function parseHeader(type: unknown, url: unknown): InfobipHeader | null {
  const kind = str(type).toUpperCase();
  const mediaUrl = str(url);
  return HEADER_TYPES.includes(kind) && mediaUrl.startsWith("https://") ? { type: kind as InfobipHeader["type"], url: mediaUrl } : null;
}

// MEDIA_TEMPLATE headers must be sent with the media or Infobip answers 7008 (template parameters mismatch).
function headerData(header: InfobipHeader | null | undefined) {
  if (!header) return {};
  const filename = header.type === "DOCUMENT" ? { filename: decodeURIComponent(new URL(header.url).pathname.split("/").pop() || "documento") } : {};
  return { header: { type: header.type, mediaUrl: header.url, ...filename } };
}

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
    const { name, language, placeholders = [], header } = input.template;
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
            content: { templateName: name, templateData: { body: { placeholders: placeholders.map(String) }, ...headerData(header) }, language },
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

export function infobipMessageId(payload: unknown): string {
  if (!isObject(payload)) return "";
  const first = Array.isArray(payload.messages) && isObject(payload.messages[0]) ? payload.messages[0] : payload;
  return str(first.messageId);
}

export function parseTemplate(metadata: unknown): InfobipTemplate | null {
  const raw = isObject(metadata) ? metadata.whatsapp_template : null;
  if (!isObject(raw)) return null;
  const placeholders = Array.isArray(raw.placeholders) ? raw.placeholders.map(str) : [];
  const header = isObject(raw.header) ? parseHeader(raw.header.type, raw.header.url) : null;
  return { name: str(raw.name), language: str(raw.language) || "pt_BR", placeholders, header };
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
