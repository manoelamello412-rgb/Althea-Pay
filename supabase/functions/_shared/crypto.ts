const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return result === 0
}

export function withinReplayWindow(timestampMs: number, toleranceMs = 5 * 60 * 1000, nowMs = Date.now()) {
  return Number.isFinite(timestampMs) && Math.abs(nowMs - timestampMs) <= toleranceMs
}
