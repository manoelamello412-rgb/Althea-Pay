import type { IaraRiskClass } from './contracts'

export interface TelemetryEvent {
  tenantId: string
  clientId: string
  productId: string
  sessionId: string
  requestId: string
  behaviorMetrics: {
    timeOnCheckoutSeconds: number
    tabSwitchesCount: number
    typingHesitationScore: number
    mouseLeaveDetected: boolean
  }
  gatewayLatencyMs: number
  observedAt: string
}

export interface PredictiveEvidence {
  factor: string
  contribution: number
  observedValue: number | boolean
}

export interface OfferContext {
  productName?: string
  paymentAlternativeAvailable: boolean
  discountAvailable: boolean
  discountPercent?: number
  customerHasPriorPurchase: boolean
}

export interface PredictiveAction {
  shouldIntervene: boolean
  riskScore: number
  riskClass: Extract<IaraRiskClass, 'read' | 'low' | 'medium' | 'high'>
  recommendedStrategy:
    | 'GENERATE_PIX_DISCOUNT'
    | 'LIVE_CHAT_RESCUE'
    | 'WAIT_AND_OBSERVE'
  generatedOfferText: string
  evidence: ReadonlyArray<PredictiveEvidence>
  interventionReason: string
}

export interface PredictiveEventSink {
  append(input: {
    tenantId: string
    userId?: string
    productId: string
    sessionId: string
    requestId: string
    eventType: 'PREDICTIVE_RESCUE'
    payload: Record<string, unknown>
  }): Promise<void>
}

export interface PredictiveOfferPolicy {
  resolve(context: TelemetryEvent): Promise<OfferContext>
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const finiteNonNegative = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? Math.max(0, value) : fallback

/**
 * Predictive recovery is deliberately advisory. It cannot change prices,
 * payment methods or checkout state by itself. Any mutation must go through
 * IARA's governed tool/approval kernel.
 */
export class IaraPredictiveRecuperator {
  constructor(
    private readonly eventSink: PredictiveEventSink,
    private readonly offerPolicy: PredictiveOfferPolicy,
  ) {}

  async analyzeClientBehavior(telemetry: TelemetryEvent): Promise<PredictiveAction> {
    this.validateTelemetry(telemetry)

    const evidence: PredictiveEvidence[] = []
    let riskScore = 0

    if (telemetry.behaviorMetrics.mouseLeaveDetected) {
      riskScore += 35
      evidence.push({ factor: 'mouse_leave', contribution: 35, observedValue: true })
    }

    const hesitation = clamp(telemetry.behaviorMetrics.typingHesitationScore, 0, 100)
    if (hesitation >= 60) {
      const contribution = Math.round(((hesitation - 60) / 40) * 20)
      riskScore += contribution
      evidence.push({ factor: 'typing_hesitation', contribution, observedValue: hesitation })
    }

    const tabSwitches = finiteNonNegative(telemetry.behaviorMetrics.tabSwitchesCount)
    if (tabSwitches >= 2) {
      const contribution = Math.min(15, Math.round(tabSwitches * 3))
      riskScore += contribution
      evidence.push({ factor: 'tab_switches', contribution, observedValue: tabSwitches })
    }

    const gatewayLatency = finiteNonNegative(telemetry.gatewayLatencyMs)
    if (gatewayLatency >= 400) {
      const contribution = Math.min(20, Math.round((gatewayLatency - 400) / 40) + 5)
      riskScore += contribution
      evidence.push({ factor: 'gateway_latency', contribution, observedValue: gatewayLatency })
    }

    const longCheckout = finiteNonNegative(telemetry.behaviorMetrics.timeOnCheckoutSeconds)
    if (longCheckout >= 180) {
      const contribution = Math.min(10, Math.floor((longCheckout - 180) / 60) + 4)
      riskScore += contribution
      evidence.push({ factor: 'checkout_duration', contribution, observedValue: longCheckout })
    }

    riskScore = clamp(Math.round(riskScore), 0, 100)

    const riskClass: PredictiveAction['riskClass'] =
      riskScore >= 75 ? 'high' : riskScore >= 45 ? 'medium' : 'low'

    const offerContext = riskScore >= 45
      ? await this.offerPolicy.resolve(telemetry)
      : undefined

    const recommendedStrategy = this.chooseStrategy(telemetry, riskScore, offerContext)
    const generatedOfferText = this.buildOfferText(telemetry, recommendedStrategy, offerContext)
    const shouldIntervene = recommendedStrategy !== 'WAIT_AND_OBSERVE'

    const action: PredictiveAction = {
      shouldIntervene,
      riskScore,
      riskClass,
      recommendedStrategy,
      generatedOfferText,
      evidence,
      interventionReason: this.reason(riskScore, recommendedStrategy),
    }

    if (shouldIntervene) {
      await this.eventSink.append({
        tenantId: telemetry.tenantId,
        productId: telemetry.productId,
        sessionId: telemetry.sessionId,
        requestId: telemetry.requestId,
        eventType: 'PREDICTIVE_RESCUE',
        payload: {
          clientId: telemetry.clientId,
          riskScore,
          riskClass,
          strategy: recommendedStrategy,
          evidence,
          observedAt: telemetry.observedAt,
        },
      })
    }

    return action
  }

  private chooseStrategy(
    telemetry: TelemetryEvent,
    riskScore: number,
    offerContext?: OfferContext,
  ): PredictiveAction['recommendedStrategy'] {
    if (riskScore < 45) return 'WAIT_AND_OBSERVE'
    if (telemetry.behaviorMetrics.mouseLeaveDetected) return 'LIVE_CHAT_RESCUE'
    if (riskScore >= 75 && offerContext?.paymentAlternativeAvailable && offerContext.discountAvailable) {
      return 'GENERATE_PIX_DISCOUNT'
    }
    return 'LIVE_CHAT_RESCUE'
  }

  private buildOfferText(
    telemetry: TelemetryEvent,
    strategy: PredictiveAction['recommendedStrategy'],
    context?: OfferContext,
  ): string {
    if (strategy === 'WAIT_AND_OBSERVE') return ''

    const product = context?.productName ? ` para ${context.productName}` : ''

    if (
      strategy === 'GENERATE_PIX_DISCOUNT' &&
      context?.paymentAlternativeAvailable &&
      context.discountAvailable &&
      context.discountPercent !== undefined
    ) {
      return `Posso oferecer uma alternativa de pagamento via Pix${product} com ${context.discountPercent}% de desconto, se essa condição estiver autorizada para esta compra.`
    }

    if (context?.paymentAlternativeAvailable) {
      return `Posso ajudar a concluir sua compra${product} e apresentar as opções de pagamento disponíveis para este checkout.`
    }

    return `Posso abrir o atendimento agora para ajudar a concluir sua compra${product}.`
  }

  private reason(
    riskScore: number,
    strategy: PredictiveAction['recommendedStrategy'],
  ): string {
    if (strategy === 'WAIT_AND_OBSERVE') return 'Behavioral risk remains below the intervention threshold.'
    if (strategy === 'GENERATE_PIX_DISCOUNT') return `High abandonment risk detected (score ${riskScore}) with an authorized payment alternative.`
    return `Elevated abandonment risk detected (score ${riskScore}); live assistance is the safer intervention.`
  }

  private validateTelemetry(telemetry: TelemetryEvent): void {
    const required = [telemetry.tenantId, telemetry.clientId, telemetry.productId, telemetry.sessionId, telemetry.requestId]
    if (required.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error('Invalid predictive telemetry identity.')
    }

    if (!Number.isFinite(telemetry.behaviorMetrics.typingHesitationScore)) {
      throw new Error('Invalid typing hesitation score.')
    }
    if (!Number.isFinite(telemetry.behaviorMetrics.tabSwitchesCount)) {
      throw new Error('Invalid tab switch count.')
    }
    if (!Number.isFinite(telemetry.behaviorMetrics.timeOnCheckoutSeconds)) {
      throw new Error('Invalid checkout duration.')
    }
    if (!Number.isFinite(telemetry.gatewayLatencyMs)) {
      throw new Error('Invalid gateway latency.')
    }
    if (!Number.isFinite(Date.parse(telemetry.observedAt))) {
      throw new Error('Invalid telemetry timestamp.')
    }
  }
}
