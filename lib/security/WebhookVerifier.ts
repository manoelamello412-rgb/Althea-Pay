export interface WebhookVerificationPayload {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  timestampHeader?: string | null;
  toleranceSeconds?: number;
}

export interface VerificationResult {
  isValid: boolean;
  reason?: string;
  parsedBody: Record<string, unknown> | null;
}

const encoder = new TextEncoder();

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function parseHeaderValue(header: string): { timestamp: string; signature: string } | null {
  const parts = header.split(',').map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith('t='));
  const signaturePart = parts.find((part) => part.startsWith('v1='));
  if (!timestampPart || !signaturePart) return null;
  const timestamp = timestampPart.slice(2).trim();
  const signature = signaturePart.slice(3).trim();
  if (!timestamp || !signature) return null;
  return { timestamp, signature };
}

function parseTimestamp(raw: string): { milliseconds: number; original: string } | null {
  if (!/^\d{10,13}$/.test(raw)) return null;
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric)) return null;
  const milliseconds = raw.length <= 10 ? numeric * 1000 : numeric;
  if (!Number.isSafeInteger(milliseconds)) return null;
  return { milliseconds, original: raw };
}

export class WebhookVerifier {
  public static async verifyPayload(options: WebhookVerificationPayload): Promise<VerificationResult> {
    const { rawBody, signatureHeader, secret, toleranceSeconds = 300 } = options;

    if (!signatureHeader) return { isValid: false, reason: 'signature_missing', parsedBody: null };
    if (!secret || secret.trim() === '') return { isValid: false, reason: 'secret_not_configured', parsedBody: null };
    if (!Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0 || toleranceSeconds > 900) {
      return { isValid: false, reason: 'invalid_tolerance', parsedBody: null };
    }

    const embedded = parseHeaderValue(signatureHeader);
    const timestampRaw = embedded?.timestamp ?? options.timestampHeader?.trim() ?? '';
    const receivedSignature = embedded?.signature ?? signatureHeader.trim();
    const timestamp = parseTimestamp(timestampRaw);
    const signatureBytes = hexToBytes(receivedSignature);

    if (!timestamp || !signatureBytes) {
      return { isValid: false, reason: 'malformed_signature', parsedBody: null };
    }

    const age = Math.abs(Date.now() - timestamp.milliseconds);
    if (age > toleranceSeconds * 1000) {
      return { isValid: false, reason: 'timestamp_outside_tolerance', parsedBody: null };
    }

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(`${timestamp.original}.${rawBody}`),
    );

    if (!valid) return { isValid: false, reason: 'invalid_signature', parsedBody: null };

    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { isValid: false, reason: 'invalid_json_shape', parsedBody: null };
      }
      return { isValid: true, parsedBody: parsed as Record<string, unknown> };
    } catch {
      return { isValid: false, reason: 'invalid_json', parsedBody: null };
    }
  }
}
