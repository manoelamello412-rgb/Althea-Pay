import { logJSON, genRequestId } from '../../lib/logging';
import { query } from '../../lib/db';

// Event worker: processes webhook_events rows and marks them processed or moves to DLQ
export default async function handler(req: any, res: any) {
  const requestId = genRequestId();
  logJSON('info','worker.start',{requestId});

  try {
    // attempt to query DB; if not configured, return noop
    let rows;
    try {
      const r = await query(`SELECT id, event_id, payload, attempts FROM webhook_events WHERE processed = false AND next_attempt_at <= now() ORDER BY received_at LIMIT 50`);
      rows = r.rows;
    } catch (e) {
      logJSON('warn','worker.no_db',{requestId, note: 'DB not configured or query failed', error: String(e)});
      return res.status(200).json({ ok: true, note: 'noop (no DB)'});
    }

    for (const row of rows) {
      const { id, event_id, payload, attempts } = row;
      logJSON('info','worker.processing',{requestId,event_id,attempts});
      try {
        // route by payload type
        if (payload && payload.type) {
          if (payload.type === 'payment_intent.succeeded' || payload.type === 'charge.succeeded') {
            // extract gateway tx id and amount
            const gatewayTxId = payload.data?.object?.id || payload.data?.object?.charge || null;
            const amount = payload.data?.object?.amount || 0;
            const currency = (payload.data?.object?.currency || 'USD').toUpperCase();

            // insert into ledger
            try {
              await query(`INSERT INTO ledger_transactions(gateway_tx_id, amount, gross, fees, net, currency, status) VALUES($1,$2,$3,$4,$5,$6,$7)`, [gatewayTxId, amount, amount, 0, amount, currency, 'settled']);
            } catch (ledgerErr) {
              logJSON('warn','worker.ledger_insert_failed',{requestId,event_id,error:String(ledgerErr)});
            }
          }
        }

        await query(`UPDATE webhook_events SET processed = true WHERE id = $1`, [id]);
        logJSON('info','worker.processed',{requestId,event_id});
      } catch (procErr) {
        const newAttempts = (attempts || 0) + 1;
        if (newAttempts >= 5) {
          await query(`INSERT INTO webhook_events_dlq(event_id, payload, reason) VALUES($1,$2,$3)`, [event_id, payload, String(procErr)]);
          await query(`DELETE FROM webhook_events WHERE id = $1`, [id]);
          logJSON('error','worker.moved_to_dlq',{requestId,event_id});
        } else {
          const nextAt = new Date(Date.now() + Math.pow(2, newAttempts) * 1000).toISOString();
          await query(`UPDATE webhook_events SET attempts = $1, next_attempt_at = $2 WHERE id = $3`, [newAttempts, nextAt, id]);
          logJSON('warn','worker.retry_scheduled',{requestId,event_id,newAttempts,nextAt});
        }
      }
    }

    return res.status(200).json({ ok: true, processed: rows.length });
  } catch (err) {
    logJSON('error','worker.error',{requestId, error: String(err)});
    return res.status(500).json({ ok: false });
  }
}
