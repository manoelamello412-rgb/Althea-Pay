import Stripe from 'stripe';
import { GatewayAdapter, GatewayAuthParams, GatewayResponse, normalizeGatewayResponse } from '../../../lib/gateway-adapter';
import { logJSON } from '../../../lib/logging';

const STRIPE_API_KEY = process.env.PSP_STRIPE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.PSP_STRIPE_WEBHOOK_SECRET || '';

export default class StripeAdapter implements GatewayAdapter {
  private readonly stripe: Stripe | null;

  constructor(private readonly apiKey: string = STRIPE_API_KEY) {
    this.stripe = this.apiKey ? new Stripe(this.apiKey, { apiVersion: '2022-11-15' }) : null;
  }

  private toGatewayResponse(pi: any): GatewayResponse {
    return normalizeGatewayResponse({
      id: pi.id,
      status: (pi.status === 'succeeded' || pi.status === 'requires_capture')
        ? 'approved'
        : (pi.status === 'requires_payment_method' ? 'declined' : 'pending'),
      amount: pi.amount ?? 0,
      currency: (pi.currency || 'usd').toUpperCase(),
      raw: pi,
    });
  }

  async authorize(params: GatewayAuthParams): Promise<GatewayResponse> {
    logJSON('info', 'stripe.authorize', { amount: params.amount, currency: params.currency });
    if (!this.stripe) {
      return { id: 'stripe_unconfigured', status: 'error', amount: params.amount, currency: params.currency.toUpperCase(), failureClass: 'unavailable', failureCode: 'provider_not_configured' };
    }

    const amountInCents = Math.round(params.amount);
    const pi = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency: params.currency.toLowerCase(),
      capture_method: 'manual',
      metadata: params.metadata || {},
    });

    return this.toGatewayResponse(pi);
  }

  async capture(authorizationId: string, amount?: number): Promise<GatewayResponse> {
    logJSON('info', 'stripe.capture', { authorizationId, amount });
    if (!this.stripe) {
      return { id: authorizationId, status: 'error', amount: amount || 0, currency: 'USD', failureClass: 'unavailable', failureCode: 'provider_not_configured' };
    }

    const opts: any = {};
    if (typeof amount === 'number') opts.amount_to_capture = Math.round(amount);

    const captured = await this.stripe.paymentIntents.capture(authorizationId, opts);
    return this.toGatewayResponse(captured);
  }

  async refund(transactionId: string, amount?: number): Promise<GatewayResponse> {
    logJSON('info', 'stripe.refund', { transactionId, amount });
    if (!this.stripe) {
      return { id: transactionId, status: 'error', amount: amount || 0, currency: 'USD', failureClass: 'unavailable', failureCode: 'provider_not_configured' };
    }

    const refundParams: any = { payment_intent: transactionId };
    if (typeof amount === 'number') refundParams.amount = Math.round(amount);

    const refund = await this.stripe.refunds.create(refundParams);
    return normalizeGatewayResponse({
      id: refund.id,
      status: refund.status === 'succeeded' ? 'approved' : 'pending',
      amount: refund.amount || amount || 0,
      currency: (refund.currency || 'usd').toUpperCase(),
      raw: refund,
    });
  }

  async void(authorizationId: string): Promise<GatewayResponse> {
    logJSON('info', 'stripe.void', { authorizationId });
    if (!this.stripe) {
      return { id: authorizationId, status: 'error', amount: 0, currency: 'USD', failureClass: 'unavailable', failureCode: 'provider_not_configured' };
    }

    const canceled = await this.stripe.paymentIntents.cancel(authorizationId);
    return this.toGatewayResponse(canceled);
  }

  async healthCheck(): Promise<{ ok: boolean; details?: unknown }> {
    logJSON('info', 'stripe.healthcheck', {});
    if (!this.stripe) return { ok: false, details: { configured: false, reason: 'provider_not_configured' } };
    try {
      const balance = await this.stripe.balance.retrieve();
      return { ok: true, details: { configured: true, balance: !!balance } };
    } catch (e) {
      return { ok: false, details: { configured: true, error: String(e) } };
    }
  }

  async handleWebhook(rawBody: unknown, headers: Record<string, string>): Promise<{ ok: boolean; event?: unknown }> {
    logJSON('info', 'stripe.webhook.received', { headers });
    if (!this.stripe || !STRIPE_WEBHOOK_SECRET) return { ok: false };

    const sig = headers['stripe-signature'] || headers['Stripe-Signature'] || '';
    try {
      const event = this.stripe.webhooks.constructEvent(rawBody as string, sig, STRIPE_WEBHOOK_SECRET);
      return { ok: true, event };
    } catch (e) {
      logJSON('warn', 'stripe.webhook.invalid_signature', { error: String(e) });
      return { ok: false };
    }
  }
}
