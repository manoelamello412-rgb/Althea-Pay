// WhatsApp via the Baileys bridge (whatsapp-bridge/). Pure (no Deno globals) so vitest can import it.

export const digits = (value: string) => value.replace(/\D/g, "");

// Checkout phones usually come without country code; bare 10–11 digit numbers are Brazilian.
export function whatsappNumber(raw: string): string {
  const value = digits(raw);
  if (value.length === 10 || value.length === 11) return "55" + value;
  return value.length >= 12 && value.length <= 15 ? value : "";
}

export function bridgeBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname)) {
    throw new Error("whatsapp_bridge_url_invalid");
  }
  return url.origin;
}

const AUDIO_TYPES: Record<string, string> = { ogg: "audio/ogg; codecs=opus", opus: "audio/ogg; codecs=opus", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", wav: "audio/wav", webm: "audio/webm" };

export function audioMimetype(path: string): string {
  return AUDIO_TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "audio/mpeg";
}

export function bridgeSendRequest(input: { baseUrl: string; token: string; accountId: string; to: string; body: string; audio?: { url: string; mimetype: string } | null }) {
  const to = whatsappNumber(input.to);
  if (!to) throw new Error("whatsapp_destination_missing");
  if (!/^[0-9a-f-]{36}$/i.test(input.accountId)) throw new Error("channel_account_not_active");
  return {
    url: bridgeBaseUrl(input.baseUrl) + "/instances/" + input.accountId + "/send",
    init: {
      method: "POST",
      headers: { authorization: "Bearer " + input.token, "content-type": "application/json" },
      body: JSON.stringify({ to, text: input.body, ...(input.audio ? { audio_url: input.audio.url, audio_mimetype: input.audio.mimetype } : {}) }),
    } satisfies RequestInit,
  };
}

export type BridgeInbound = { accountId: string; from: string; messageId: string; text: string; name: string | null; type: string };

export function parseBridgeInbound(payload: unknown): BridgeInbound | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const accountId = str(p.account_id), from = digits(str(p.from)), messageId = str(p.message_id), text = str(p.text);
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !from || !messageId || !text) return null;
  return { accountId, from, messageId, text: text.slice(0, 4000), name: str(p.name) || null, type: str(p.type) || "text" };
}

export function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let n = 0;
  for (let i = 0; i < x.length; i++) n |= x[i] ^ y[i];
  return n === 0;
}
