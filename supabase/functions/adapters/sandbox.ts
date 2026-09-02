import type { GatewayAdapter, GatewayAuthParams, GatewayResponse } from '../../../lib/gateway-adapter'
import { simulateSandboxPayment, type SandboxScenario } from '../_shared/gateway-sandbox-sim'

function response(result: ReturnType<typeof simulateSandboxPayment>): GatewayResponse {
  return {
    id: result.id,
    status: result.status === 'approved' || result.status === 'declined' ? result.status : 'error',
    amount: result.amount,
    currency: result.currency,
    raw: result,
  }
}

export class SandboxGatewayAdapter implements GatewayAdapter {
  async authorize(params: GatewayAuthParams): Promise<GatewayResponse> {
    const metadata = params.metadata ?? {}
    const scenario = metadata.scenario as SandboxScenario | undefined
    return response(simulateSandboxPayment({
      amount: params.amount,
      currency: params.currency,
      idempotency_key: params.idempotencyKey,
      ...metadata,
    }, scenario ? { forceScenario: scenario } : undefined))
  }

  async capture(authorizationId: string, amount = 0): Promise<GatewayResponse> {
    return { id: authorizationId, status: 'approved', amount, currency: 'BRL', raw: { sandbox: true, operation: 'capture' } }
  }

  async refund(transactionId: string, amount = 0): Promise<GatewayResponse> {
    return { id: transactionId, status: 'approved', amount, currency: 'BRL', raw: { sandbox: true, operation: 'refund' } }
  }

  async void(authorizationId: string): Promise<GatewayResponse> {
    return { id: authorizationId, status: 'approved', amount: 0, currency: 'BRL', raw: { sandbox: true, operation: 'void' } }
  }

  async healthCheck() {
    return { ok: true, details: { gateway: 'sandbox', deterministic: true } }
  }

  async handleWebhook(rawBody: unknown, _headers: Record<string, string>) {
    return { ok: true, event: rawBody }
  }
}

export const sandboxAdapter = new SandboxGatewayAdapter()
