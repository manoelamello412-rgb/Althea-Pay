import { createHash, createPrivateKey, createSign, randomUUID } from 'node:crypto'
import type { IaraToolCall, IaraToolContext } from './contracts'

const DEFAULT_KID = 'althea-feb-2026-09-10-k1'
const DEFAULT_AUDIENCE = 'althea-gateway-orchestrator'
const DEFAULT_TICKET_MAX_SECONDS = 60

type FinancialAction = 'purchase' | 'capture' | 'refund' | 'void'

export interface IaraFEBTicket {
  readonly jti: string
  readonly executionId: string
  readonly tenantId: string
  readonly userId: string
  readonly toolKey: string
  readonly toolVersion: number
  readonly gatewayId: string
  readonly action: FinancialAction
  readonly idempotencyKey: string
  readonly requestFingerprint: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly iat: number
  readonly exp: number
  readonly iss: string
  readonly aud: string
  readonly issuer: string
  readonly audience: string
  readonly kid: string
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    )
  }
  return value
}

function actionOf(input: Record<string, unknown>): FinancialAction | null {
  const action = typeof input.action === 'string' ? input.action.trim().toLowerCase() : ''
  return ['purchase', 'capture', 'refund', 'void'].includes(action) ? action as FinancialAction : null
}

function gatewayIdOf(input: Record<string, unknown>): string {
  return typeof input.gateway_id === 'string' ? input.gateway_id.trim() : ''
}

function fingerprint(call: IaraToolCall, context: IaraToolContext, gatewayId: string, action: FinancialAction, idempotencyKey: string): string {
  const canonical = JSON.stringify(stable({
    tenant_id: context.tenantId,
    user_id: context.userId,
    tool_key: call.toolKey,
    tool_version: call.version,
    gateway_id: gatewayId,
    action,
    idempotency_key: idempotencyKey,
    input: call.input,
  }))
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export function issueFEBTicket(call: IaraToolCall, context: IaraToolContext): string | null {
  const gatewayId = gatewayIdOf(call.input)
  const action = actionOf(call.input)
  const idempotencyKey = call.idempotencyKey?.trim() ?? ''
  if (!gatewayId || !action || !idempotencyKey) return null

  const privateKeyPem = process.env.ALTHEA_FEB_PRIVATE_KEY?.trim()
  const issuer = process.env.ALTHEA_FEB_ISSUER?.trim()
  const audience = process.env.ALTHEA_FEB_AUDIENCE?.trim() || DEFAULT_AUDIENCE
  const kid = process.env.ALTHEA_FEB_KID?.trim() || DEFAULT_KID
  if (!privateKeyPem || !issuer) return null

  const now = Math.floor(Date.now() / 1000)
  const maxSeconds = Number(process.env.ALTHEA_FEB_TICKET_MAX_SECONDS || DEFAULT_TICKET_MAX_SECONDS)
  const ttl = Number.isFinite(maxSeconds) && maxSeconds > 0 ? Math.min(Math.floor(maxSeconds), 60) : DEFAULT_TICKET_MAX_SECONDS
  const expiresAt = now + ttl
  const payload: IaraFEBTicket = {
    jti: randomUUID(),
    executionId: context.executionId,
    tenantId: context.tenantId,
    userId: context.userId,
    toolKey: call.toolKey,
    toolVersion: call.version,
    gatewayId,
    action,
    idempotencyKey,
    requestFingerprint: fingerprint(call, context, gatewayId, action, idempotencyKey),
    issuedAt: now,
    expiresAt,
    iat: now,
    exp: expiresAt,
    iss: issuer,
    aud: audience,
    issuer,
    audience,
    kid,
  }

  const header = { alg: 'RS256', kid, typ: 'JWT' }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign(createPrivateKey(privateKeyPem))
  return `${signingInput}.${base64url(signature)}`
}
