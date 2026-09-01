import { GatewayAdapter, GatewayAuthParams, GatewayResponse } from '../../lib/gateway-adapter';
import { logJSON } from '../../lib/logging';

// Stripe adapter skeleton (sandbox-first)
// NOTE: This file is a skeleton and will not work without STRIPE_API_KEY (sandbox key) provided as a secret.

const STRIPE_API_KEY = process.env.PSP_STRIPE_KEY || '';

export default class StripeAdapter implements GatewayAdapter {
  constructor(private apiKey: string = STRIPE_API_KEY) {}

  async authorize(params: GatewayAuthParams): Promise<GatewayResponse> {
    logJSON('info','stripe.authorize',{amount: params.amount, currency: params.currency});
    if (!this.apiKey) {
      return { id: 'sandbox-unauth', status: 'approved', amount: params.amount, currency: params.currency, raw: { note: 'no API key configured; sandbox response' } };
    }

    // TODO: Implement real Stripe PaymentIntent creation with capture_method=manual
    // Example (node stripe): stripe.paymentIntents.create({ amount, currency, capture_method: 'manual' })

    return { id: 'pi_sandbox_123', status: 'approved', amount: params.amount, currency: params.currency, raw: {} };
  }

  async capture(authorizationId: string, amount?: number): Promise<GatewayResponse> {
    logJSON('info','stripe.capture',{authorizationId, amount});
    // TODO: call Stripe API to capture PaymentIntent
    return { id: authorizationId, status: 'approved', amount: amount || 0, currency: 'USD', raw: {} };
  }

  async refund(transactionId: string, amount?: number): Promise<GatewayResponse> {
    logJSON('info','stripe.refund',{transactionId, amount});
    // TODO: call Stripe API to refund charge
    return { id: transactionId, status: 'approved', amount: amount || 0, currency: 'USD', raw: {} };
  }

  async void(authorizationId: string): Promise<GatewayResponse> {
    logJSON('info','stripe.void',{authorizationId});
    // TODO: cancel the PaymentIntent if possible
    return { id: authorizationId, status: 'approved', amount: 0, currency: 'USD', raw: {} };
  }

  async healthCheck(): Promise<{ ok: boolean; details?: any }> {
    logJSON('info','stripe.healthcheck',{});
    // If apiKey absent, return degraded but OK for sandbox
    if (!this.apiKey) return { ok: true, details: { sandbox: true } };
    // TODO: perform real API call to check connectivity
    return { ok: true };
  }

  async handleWebhook(rawBody: any, headers: Record<string,string>): Promise<{ ok: boolean; event?: any }> {
    logJSON('info','stripe.webhook.received',{headers});
    // TODO: verify stripe signature and parse event
    // For sandbox fallback, accept and echo
    return { ok: true, event: rawBody };
  }
}
