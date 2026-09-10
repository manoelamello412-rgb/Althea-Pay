import { describe, expect, it, vi } from 'vitest'
import { IaraPredictiveRecuperator, type OfferContext, type TelemetryEvent } from './predictive-recuperator'

const telemetry = (overrides: Partial<TelemetryEvent['behaviorMetrics']> = {}): TelemetryEvent => ({
  tenantId: '00000000-0000-0000-0000-000000000001',
  clientId: '00000000-0000-0000-0000-000000000002',
  productId: '00000000-0000-0000-0000-000000000003',
  sessionId: '00000000-0000-0000-0000-000000000004',
  requestId: '00000000-0000-0000-0000-000000000005',
  behaviorMetrics: {
    timeOnCheckoutSeconds: 30,
    tabSwitchesCount: 0,
    typingHesitationScore: 0,
    mouseLeaveDetected: false,
    ...overrides,
  },
  gatewayLatencyMs: 100,
  observedAt: '2026-09-10T12:00:00.000Z',
})

describe('IaraPredictiveRecuperator', () => {
  it('does not intervene for low-risk behavior', async () => {
    const append = vi.fn().mockResolvedValue(undefined)
    const resolver = vi.fn<() => Promise<OfferContext>>()
    const engine = new IaraPredictiveRecuperator({ append }, { resolve: resolver })

    const result = await engine.analyzeClientBehavior(telemetry())

    expect(result.shouldIntervene).toBe(false)
    expect(result.recommendedStrategy).toBe('WAIT_AND_OBSERVE')
    expect(append).not.toHaveBeenCalled()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('records a high-risk rescue without granting an unauthorized discount', async () => {
    const append = vi.fn().mockResolvedValue(undefined)
    const context: OfferContext = {
      productName: 'Produto Premium',
      paymentAlternativeAvailable: true,
      discountAvailable: false,
      customerHasPriorPurchase: true,
    }
    const engine = new IaraPredictiveRecuperator(
      { append },
      { resolve: vi.fn().mockResolvedValue(context) },
    )

    const result = await engine.analyzeClientBehavior(
      telemetry({
        timeOnCheckoutSeconds: 300,
        tabSwitchesCount: 4,
        typingHesitationScore: 95,
        mouseLeaveDetected: true,
      }),
    )

    expect(result.riskScore).toBeGreaterThanOrEqual(75)
    expect(result.riskClass).toBe('high')
    expect(result.recommendedStrategy).toBe('LIVE_CHAT_RESCUE')
    expect(result.generatedOfferText).not.toContain('% de desconto')
    expect(append).toHaveBeenCalledOnce()
  })

  it('only recommends a Pix discount when the policy explicitly authorizes it', async () => {
    const append = vi.fn().mockResolvedValue(undefined)
    const context: OfferContext = {
      productName: 'Produto Premium',
      paymentAlternativeAvailable: true,
      discountAvailable: true,
      discountPercent: 5,
      customerHasPriorPurchase: false,
    }
    const engine = new IaraPredictiveRecuperator(
      { append },
      { resolve: vi.fn().mockResolvedValue(context) },
    )

    const result = await engine.analyzeClientBehavior(
      telemetry({
        timeOnCheckoutSeconds: 300,
        tabSwitchesCount: 4,
        typingHesitationScore: 95,
        mouseLeaveDetected: false,
      }),
    )

    expect(result.recommendedStrategy).toBe('GENERATE_PIX_DISCOUNT')
    expect(result.generatedOfferText).toContain('5% de desconto')
  })

  it('rejects invalid telemetry instead of silently producing a false prediction', async () => {
    const engine = new IaraPredictiveRecuperator(
      { append: vi.fn() },
      { resolve: vi.fn() },
    )

    await expect(
      engine.analyzeClientBehavior(telemetry({ typingHesitationScore: Number.NaN })),
    ).rejects.toThrow('Invalid typing hesitation score.')
  })
})
