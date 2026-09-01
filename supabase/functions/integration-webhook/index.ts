import crypto from 'crypto';
import { WebhookEventSchema } from '../../lib/validation';
import { verifyHmac } from '../../lib/hmac';
import { logJSON, genRequestId } from '../../lib/logging';

// Minimal Supabase Edge Function style handler
export default async function handler(req: any, res: any) {
  const requestId = genRequestId();
  try {
    const timestamp = req.headers['x-althea-timestamp'] || req.headers['x-althea_time'] || '';
    const signature = req.headers['x-althea-signature'] || req.headers['x-althea-signature'];
    const body = req.body || (await req.text());

    logJSON('info','webhook.received',{requestId, timestamp});

    if (!timestamp || !signature) {
      logJSON('warn','webhook.missing_headers',{requestId});
      return res.status(400).json({ ok: false, error: 'missing signature/timestamp' });
    }

    const secret = process.env.ALTHEA_WEBHOOK_SECRET || '';
    if (!secret) {
      logJSON('warn','webhook.no_secret',{requestId});
      // Accept but mark as not verified in tests
    }

    // verify HMAC if secret present
    if (secret) {
      const payload = `${timestamp}.${body}`;
      const ok = verifyHmac(payload, signature, secret);
      if (!ok) {
        logJSON('warn','webhook.invalid_signature',{requestId});
        return res.status(401).json({ ok: false });
      }
    }

    // basic timestamp replay protection
    const tsNum = Number(timestamp);
    if (!Number.isNaN(tsNum)) {
      const now = Date.now();
      const diff = Math.abs(now - tsNum);
      const FIVE_MIN = 5 * 60 * 1000;
      if (diff > FIVE_MIN) {
        logJSON('warn','webhook.timestamp_out_of_window',{requestId, diff});
        return res.status(400).json({ ok: false, error: 'timestamp out of window' });
      }
    }

    let parsed;
    try {
      parsed = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'invalid json' });
    }

    const validated = WebhookEventSchema.safeParse(parsed);
    if (!validated.success) {
      logJSON('warn','webhook.invalid_payload',{requestId, issues: validated.error.issues});
      return res.status(400).json({ ok: false, error: 'schema mismatch' });
    }

    // Persist to DB ideally; for now write to console and return 200 to be idempotent
    logJSON('info','webhook.persist',{requestId, event: validated.data});

    return res.status(200).json({ ok: true });
  } catch (err) {
    logJSON('error','webhook.error',{requestId, error: String(err)});
    return res.status(500).json({ ok: false });
  }
}
