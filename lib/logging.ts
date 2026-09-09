import crypto from 'crypto'

export type LogMeta = Record<string, unknown>

export function genRequestId(): string {
  return crypto.randomBytes(12).toString('hex')
}

export function logJSON(level: 'info' | 'warn' | 'error' | 'debug', msg: string, meta: LogMeta = {}): void {
  const out = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    ...meta,
  }
  // keep logs JSON-serializable and avoid leaking secrets
  console.log(JSON.stringify(out))
}
