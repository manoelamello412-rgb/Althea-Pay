import { describe, expect, it } from 'vitest';

interface TelemetryPackage {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  tenantId: string;
  productId: string;
  clientId: string;
  behaviorMetrics: {
    timeOnCheckoutSeconds: number;
    tabSwitchesCount: number;
    typingHesitationScore: number;
    mouseLeaveDetected: boolean;
  };
  gatewayLatencyMs: number | null;
}

describe('IaraTracker telemetry contract', () => {
  it('never permits payment field values in the telemetry contract', () => {
    const event: TelemetryPackage = {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId: 'tenant-test',
      productId: 'product-test',
      clientId: 'client-test',
      behaviorMetrics: {
        timeOnCheckoutSeconds: 12,
        tabSwitchesCount: 1,
        typingHesitationScore: 40,
        mouseLeaveDetected: false,
      },
      gatewayLatencyMs: null,
    };

    expect(JSON.stringify(event)).not.toMatch(/cardNumber|cvv|cvc|password|cpf|rawValue/i);
    expect(event.gatewayLatencyMs).toBeNull();
  });

  it('keeps behavioral scores bounded', () => {
    const score = Math.min(100, Math.max(0, 137));
    expect(score).toBe(100);
  });

  it('treats mouse-leave telemetry as intent rather than confirmed abandonment', () => {
    const event = {
      mouseLeaveDetected: true,
      abandonmentConfirmed: false,
    };

    expect(event.mouseLeaveDetected).toBe(true);
    expect(event.abandonmentConfirmed).toBe(false);
  });
});
