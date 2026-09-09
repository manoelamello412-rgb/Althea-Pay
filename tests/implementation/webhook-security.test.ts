import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { WebhookVerifier } from '../../lib/security/WebhookVerifier';

const TEST_SECRET = 'test_webhook_secret_for_althea_security';

function sign(timestamp: number, rawBody: string): string {
  return createHmac('sha256', TEST_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
}

describe('WebhookVerifier', () => {
  test('accepts a valid combined t/v1 signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ event_type: 'payment.approved', amount: 499.9, currency: 'BRL' });
    const result = await WebhookVerifier.verifyPayload({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${sign(timestamp, rawBody)}`,
      secret: TEST_SECRET,
    });
    expect(result.isValid).toBe(true);
    expect(result.parsedBody?.event_type).toBe('payment.approved');
  });

  test('accepts the existing ALTHEA separate timestamp/signature header contract', async () => {
    const timestamp = Date.now();
    const rawBody = JSON.stringify({ event_type: 'payment.approved' });
    const result = await WebhookVerifier.verifyPayload({
      rawBody,
      signatureHeader: sign(timestamp, rawBody),
      timestampHeader: String(timestamp),
      secret: TEST_SECRET,
    });
    expect(result.isValid).toBe(true);
  });

  test('rejects a tampered payload', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const original = JSON.stringify({ amount: 100 });
    const tampered = JSON.stringify({ amount: 99999 });
    const result = await WebhookVerifier.verifyPayload({
      rawBody: tampered,
      signatureHeader: `t=${timestamp},v1=${sign(timestamp, original)}`,
      secret: TEST_SECRET,
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('invalid_signature');
    expect(result.parsedBody).toBeNull();
  });

  test('rejects a timestamp outside the replay window', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 601;
    const rawBody = JSON.stringify({ amount: 50 });
    const result = await WebhookVerifier.verifyPayload({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${sign(timestamp, rawBody)}`,
      secret: TEST_SECRET,
      toleranceSeconds: 300,
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('timestamp_outside_tolerance');
  });

  test('rejects malformed signatures before cryptographic verification', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const result = await WebhookVerifier.verifyPayload({
      rawBody: '{}',
      signatureHeader: `t=${timestamp},v1=not-a-hex-signature`,
      secret: TEST_SECRET,
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('malformed_signature');
  });

  test('rejects validly signed non-object JSON', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = '[]';
    const result = await WebhookVerifier.verifyPayload({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${sign(timestamp, rawBody)}`,
      secret: TEST_SECRET,
    });
    expect(result.isValid).toBe(false);
    expect(result.reason).toBe('invalid_json_shape');
  });
});
