import { describe, expect, it } from 'vitest'
import crypto from 'crypto'

function sign(body: string, timestamp: number, secret: string) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

describe('timestamped webhook HMAC contract', () => {
  it('signs timestamp + raw body', () => {
    const signature = sign('{"event":"purchase"}', 1700000000000, 'test-secret')
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('changes when the body changes', () => {
    const a = sign('{"amount":10}', 1700000000000, 'test-secret')
    const b = sign('{"amount":11}', 1700000000000, 'test-secret')
    expect(a).not.toBe(b)
  })

  it('changes when the timestamp changes', () => {
    const a = sign('{"event":"purchase"}', 1700000000000, 'test-secret')
    const b = sign('{"event":"purchase"}', 1700000001000, 'test-secret')
    expect(a).not.toBe(b)
  })
})
