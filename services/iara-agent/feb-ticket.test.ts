import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it, afterEach } from 'vitest'
import { issueFEBTicket } from './feb-ticket'
import type { IaraToolCall, IaraToolContext } from './contracts'

describe('issueFEBTicket', () => {
  const previous = {
    key: process.env.ALTHEA_FEB_PRIVATE_KEY,
    issuer: process.env.ALTHEA_FEB_ISSUER,
    audience: process.env.ALTHEA_FEB_AUDIENCE,
    kid: process.env.ALTHEA_FEB_KID,
  }

  afterEach(() => {
    process.env.ALTHEA_FEB_PRIVATE_KEY = previous.key
    process.env.ALTHEA_FEB_ISSUER = previous.issuer
    process.env.ALTHEA_FEB_AUDIENCE = previous.audience
    process.env.ALTHEA_FEB_KID = previous.kid
  })

  it('fails closed when the signing key or issuer is unavailable', () => {
    delete process.env.ALTHEA_FEB_PRIVATE_KEY
    delete process.env.ALTHEA_FEB_ISSUER
    const call: IaraToolCall = { toolKey: 'gateway.purchase', version: 1, input: { gateway_id: 'gw-1', action: 'purchase' }, idempotencyKey: 'idem-1' }
    const context: IaraToolContext = { userId: 'user-1', tenantId: 'tenant-1', sessionId: 'session-1', executionId: 'exec-1', requestId: 'req-1' }
    expect(issueFEBTicket(call, context)).toBeNull()
  })

  it('emits an RS256 JWT with standard and FEB binding claims', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.ALTHEA_FEB_PRIVATE_KEY = privatePem
    process.env.ALTHEA_FEB_ISSUER = 'althea-iara-kernel'
    process.env.ALTHEA_FEB_AUDIENCE = 'althea-gateway-orchestrator'
    process.env.ALTHEA_FEB_KID = 'test-k1'

    const call: IaraToolCall = {
      toolKey: 'gateway.purchase',
      version: 3,
      input: { gateway_id: 'gw-1', action: 'purchase', amount: 1990, currency: 'BRL' },
      idempotencyKey: 'idem-1',
    }
    const context: IaraToolContext = { userId: 'user-1', tenantId: 'tenant-1', sessionId: 'session-1', executionId: 'exec-1', requestId: 'req-1' }
    const token = issueFEBTicket(call, context)
    expect(token).toBeTruthy()

    const [header, encodedPayload, signature] = token!.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))).toMatchObject({ alg: 'RS256', kid: 'test-k1', typ: 'JWT' })
    expect(payload).toMatchObject({ iss: 'althea-iara-kernel', aud: 'althea-gateway-orchestrator', iat: expect.any(Number), exp: expect.any(Number), tenantId: 'tenant-1', userId: 'user-1', gatewayId: 'gw-1', action: 'purchase', idempotencyKey: 'idem-1' })
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60)

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${encodedPayload}`)
    verifier.end()
    expect(verifier.verify(publicPem, Buffer.from(signature, 'base64url'))).toBe(true)
  })
})
