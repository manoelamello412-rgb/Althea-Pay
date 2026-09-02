import crypto from 'crypto'

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000

export function signWebhook(body: string | Buffer, timestampMs: number, secret: string) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestampMs}.${body}`).digest('hex')}`
}

export function verifyHMAC(
  body: string | Buffer,
  signature: string,
  secret: string,
  timestampMs?: number,
  nowMs = Date.now(),
  toleranceMs = DEFAULT_TOLERANCE_MS,
) {
  if (!secret || !signature) return false
  if (timestampMs !== undefined && Math.abs(nowMs - timestampMs) > toleranceMs) return false
  const expected = signWebhook(body, timestampMs ?? nowMs, secret)
  return timingSafeEqual(expected, signature)
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}
