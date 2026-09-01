import { getIdempotency, saveIdempotency } from '../lib/idempotency';
import { query } from '../lib/db';

const HEADERS_IDEMPOTENCY = ['Idempotency-Key','idempotency-key','idempotency_key'];

export async function getIdempotencyFromRequest(req: any) {
  for (const h of HEADERS_IDEMPOTENCY) {
    const key = req.headers[h.toLowerCase()] || req.headers[h];
    if (key) return key;
  }
  return null;
}

export async function dbGetIdempotency(key: string) {
  try {
    const r = await query(`SELECT response FROM idempotency_keys WHERE key = $1`, [key]);
    if (r.rows.length) return r.rows[0].response;
    return null;
  } catch (e) {
    return null;
  }
}

export async function dbSaveIdempotency(key: string, response: any) {
  try {
    await query(`INSERT INTO idempotency_keys(key,response) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response`, [key, response]);
  } catch (e) {
    // swallow; fallback in-memory already handles
  }
}

export async function useIdempotencyFromReq(req: any, handler: () => Promise<any>) {
  const key = await getIdempotencyFromRequest(req);
  if (!key) return handler();

  // check DB first
  const dbVal = await dbGetIdempotency(key);
  if (dbVal) return dbVal;

  // then memory
  const mem = await getIdempotency(key);
  if (mem) return mem;

  const result = await handler();
  // attempt DB save
  await dbSaveIdempotency(key, result);
  // and memory save
  await saveIdempotency(key, result);
  return result;
}
