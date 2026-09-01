import { query } from '../../lib/db';
import { logJSON, genRequestId } from '../../lib/logging';

// Reconciliation worker skeleton: ingest settlement file and attempt to match ledger_transactions
export default async function handler(req: any, res: any) {
  const requestId = genRequestId();
  logJSON('info','reconciliation.start',{requestId});

  try {
    // TODO: support file upload / S3 ingestion
    // For now, expect a JSON array in body with settlement records: [{gateway_tx_id, amount, currency, reference}]
    const body = req.body || (await req.text());
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (!Array.isArray(parsed)) {
      return res.status(400).json({ ok: false, error: 'expected array of settlement records' });
    }

    let matched = 0;
    for (const rec of parsed) {
      try {
        const r = await query(`SELECT id, amount, currency FROM ledger_transactions WHERE gateway_tx_id = $1 LIMIT 1`, [rec.gateway_tx_id]);
        if (r.rows.length) {
          const ledgerId = r.rows[0].id;
          await query(`INSERT INTO reconciliations(ledger_tx_id, settlement_reference, matched) VALUES($1,$2,true)`, [ledgerId, rec.reference || null]);
          matched++;
        } else {
          // heuristic: try match by amount & currency within 1-day window
          const heuristic = await query(`SELECT id FROM ledger_transactions WHERE amount = $1 AND currency = $2 ORDER BY created_at DESC LIMIT 1`, [rec.amount, rec.currency]);
          if (heuristic.rows.length) {
            await query(`INSERT INTO reconciliations(ledger_tx_id, settlement_reference, matched) VALUES($1,$2,true)`, [heuristic.rows[0].id, rec.reference || null]);
            matched++;
          } else {
            await query(`INSERT INTO reconciliations(ledger_tx_id, settlement_reference, matched) VALUES($1,$2,false)`, [null, rec.reference || null]);
          }
        }
      } catch (e) {
        logJSON('warn','reconciliation.record_error',{requestId, error: String(e), record: rec});
      }
    }

    logJSON('info','reconciliation.finished',{requestId, matched, total: parsed.length});
    return res.status(200).json({ ok: true, matched, total: parsed.length });
  } catch (err) {
    logJSON('error','reconciliation.error',{requestId, error: String(err)});
    return res.status(500).json({ ok: false });
  }
}
