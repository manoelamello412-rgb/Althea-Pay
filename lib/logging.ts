import crypto from 'crypto';

export function genRequestId() {
  return crypto.randomBytes(12).toString('hex');
}

export function logJSON(level: 'info'|'warn'|'error'|'debug', msg: string, meta: Record<string, any> = {}) {
  const out = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    ...meta,
  };
  // keep logs JSON-serializable and avoid leaking secrets
  console.log(JSON.stringify(out));
}
