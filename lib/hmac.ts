import crypto from 'crypto'

export function verifyHMAC(payload: string | Buffer, signature: string, secret: string) {
  const h = crypto.createHmac('sha256', secret)
  h.update(payload)
  const digest = `sha256=${h.digest('hex')}`
  // safe compare
  return timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

function timingSafeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
