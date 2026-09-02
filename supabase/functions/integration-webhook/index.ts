import { getIdempotency, saveIdempotency } from '../../lib/idempotency';
import { query } from '../../lib/db';
import { WebhookEventSchema } from '../../lib/validation';
import { verifyHmac } from '../../lib/hmac';
import { logJSON, genRequestId } from '../../lib/logging';

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
    if (secret) {
      const payload = `${timestamp}.${body}`;
      const ok = verifyHmac(payload, signature, secret);
      if (!ok) {
        logJSON('warn','webhook.invalid_signature',{requestId});
        return res.status(401).json({ ok: false });
      }
    }

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

    const eventId = validated.data.id || `evt_${Math.random().toString(36).slice(2,9)}`;

    // Persist into DB if available, else log and return 200
    try {
      await query(
        `INSERT INTO webhook_events(event_id, payload) VALUES($1,$2) ON CONFLICT (event_id) DO NOTHING`,
        [eventId, validated.data]
      );
      logJSON('info','webhook.persisted',{requestId,eventId});
    } catch (dbErr) {
      logJSON('warn','webhook.persist_db_error',{requestId,error:String(dbErr)});
      // fallback: keep in-memory idempotency store
      await saveIdempotency(`webhook:${eventId}`, validated.data);
      logJSON('info','webhook.persisted_in_memory',{requestId,eventId});
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    logJSON('error','webhook.error',{requestId, error: String(err)});
    return res.status(500).json({ ok: false });
  }
}
