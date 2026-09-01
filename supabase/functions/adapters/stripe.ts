import Stripe from 'stripe';
import { GatewayAdapter, GatewayAuthParams, GatewayResponse } from '../../../lib/gateway-adapter';
import { logJSON } from '../../../lib/logging';

const STRIPE_API_KEY = process.env.PSP_STRIPE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.PSP_STRIPE_WEBHOOK_SECRET || '';

const stripe = STRIPE_API_KEY ? new Stripe(STRIPE_API_KEY, { apiVersion: '2022-11-15' }) : null;

export default class StripeAdapter implements GatewayAdapter {
  constructor(private apiKey: string = STRIPE_API_KEY) {}

  private toGatewayResponse(pi: any): GatewayResponse {
    return {
      id: pi.id,
      status: (pi.status === 'succeeded' || pi.status === 'requires_capture') ? 'approved' : (pi.status === 'requires_payment_method' ? 'declined' : 'pending'),
      amount: pi.amount ?? 0,
      currency: (pi.currency || 'usd').toUpperCase(),
      raw: pi,
    };
  }

  async authorize(params: GatewayAuthParams): Promise<GatewayResponse> {
    logJSON('info','stripe.authorize',{amount: params.amount, currency: params.currency});
    if (!stripe) {
      return { id: 'sandbox-pi', status: 'approved', amount: params.amount, currency: params.currency.toUpperCase(), raw: { note: 'sandbox' } };
    }

    const amountInCents = Math.round(params.amount);
    const pi = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: params.currency.toLowerCase(),
      capture_method: 'manual',
      metadata: params.metadata || {},
    });

    return this.toGatewayResponse(pi);
  }

  async capture(authorizationId: string, amount?: number): Promise<GatewayResponse> {
    logJSON('info','stripe.capture',{authorizationId, amount});
    if (!stripe) return { id: authorizationId, status: 'approved', amount: amount || 0, currency: 'USD', raw: { note: 'sandbox-capture' } };

    const opts: any = {};
    if (typeof amount === 'number') opts.amount_to_capture = Math.round(amount);

    const captured = await stripe.paymentIntents.capture(authorizationId, opts);
    return this.toGatewayResponse(captured);
  }

  async refund(transactionId: string, amount?: number): Promise<GatewayResponse> {
    logJSON('info','stripe.refund',{transactionId, amount});
    if (!stripe) return { id: transactionId, status: 'approved', amount: amount || 0, currency: 'USD', raw: { note: 'sandbox-refund' } };

    // Stripe refunds typically reference a charge. Try to refund by payment_intent
    const refundParams: any = { payment_intent: transactionId };
    if (typeof amount === 'number') refundParams.amount = Math.round(amount);

    const refund = await stripe.refunds.create(refundParams);
    return { id: refund.id, status: refund.status === 'succeeded' ? 'approved' : 'pending', amount: refund.amount || amount || 0, currency: (refund.currency || 'usd').toUpperCase(), raw: refund };
  }

  async void(authorizationId: string): Promise<GatewayResponse> {
    logJSON('info','stripe.void',{authorizationId});
    if (!stripe) return { id: authorizationId, status: 'approved', amount: 0, currency: 'USD', raw: { note: 'sandbox-void' } };

    const canceled = await stripe.paymentIntents.cancel(authorizationId);
    return this.toGatewayResponse(canceled);
  }

  async healthCheck(): Promise<{ ok: boolean; details?: any }> {
    logJSON('info','stripe.healthcheck',{});
    if (!stripe) return { ok: true, details: { sandbox: true } };
    try {
      // Use a lightweight request to the API
      const balance = await stripe.balance.retrieve();
      return { ok: true, details: { balance: !!balance } };
    } catch (e) {
      return { ok: false, details: String(e) };
    }
  }

  async handleWebhook(rawBody: any, headers: Record<string,string>): Promise<{ ok: boolean; event?: any }> {
    logJSON('info','stripe.webhook.received',{headers});
    if (!stripe || !STRIPE_WEBHOOK_SECRET) return { ok: true, event: rawBody };

    const sig = headers['stripe-signature'] || headers['Stripe-Signature'] || '';
    try {
      const event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
      return { ok: true, event };
    } catch (e) {
      logJSON('warn','stripe.webhook.invalid_signature',{error: String(e)});
      return { ok: false };
    }
  }
}
