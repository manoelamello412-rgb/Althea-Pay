import type { GatewayAdapter, GatewayAuthParams, GatewayResponse } from '../../../lib/gateway-adapter'
import { simulateSandboxPayment } from '../_shared/gateway-sandbox-sim'

export class SandboxGatewayAdapter implements GatewayAdapter {
  async authorize(params: GatewayAuthParams): Promise<GatewayResponse> {
    const result = simulateSandboxPayment({ amount: params.amount, currency: params.currency, idempotency_key: params.idempotencyKey, ...(params.metadata ?? {}) })
    return { id: result.id, status: result.status === 'approved' ? 'approved' : result.status === 'declined' ? 'declined' : 'error', amount: result.amount, currency: result.currency, raw: result }
  }

  async capture(authorizationId: string, amount?: number): Promise<GatewayResponse> {
    return { id: authorizationId, status: 'approved', amount: amount ?? 0, currency: 'BRL', raw: { sandbox: true, operation: 'capture' } }
  }

  async refund(transactionId: string, amount?: number): Promise<GatewayResponse> {
    return { id: transactionId, status: 'approved', amount: amount ?? 0, currency: 'BRL', raw: { sandbox: true, operation: 'refund' } }
  }

  async void(authorizationId: string): Promise<GatewayResponse> {
    return { id: authorizationId, status: 'approved', amount: 0, currency: 'BRL', raw: { sandbox: true, operation: 'void' } }
  }

  async healthCheck() { return { ok: true, details: { gateway: 'sandbox' } } }

  async handleWebhook(rawBody: unknown) { return { ok: true, event: rawBody } }
}

export const sandboxAdapter = new SandboxGatewayAdapter()
