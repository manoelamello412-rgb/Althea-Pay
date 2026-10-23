export const PAYMENT_METHODS = ['pix', 'credit_card', 'debit_card', 'boleto'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'paid',
  'failed',
  'unknown',
  'cancelled',
  'refunded',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const ROUTING_ACTIONS = ['route', 'fallback', 'park'] as const
export type RoutingAction = (typeof ROUTING_ACTIONS)[number]

export type Money = {
  amount: number
  currency: string
}

export type PaymentRequest = {
  organizationId: string
  funnelId: string
  customerId?: string
  externalReference?: string
  amount: number
  currency: string
  method: PaymentMethod
  idempotencyKey: string
  metadata?: Record<string, unknown>
}

export type RoutingContext = {
  amount: number
  currency: string
  method: PaymentMethod
  cardBrand?: string
  installments?: number
  country?: string
}

export type RoutingConditions = {
  minAmount?: number
  maxAmount?: number
  currencies?: string[]
  methods?: PaymentMethod[]
  cardBrands?: string[]
  installmentsMin?: number
  installmentsMax?: number
  countries?: string[]
}

export type GatewayCapability = {
  methods: PaymentMethod[]
  currencies: string[]
  cardBrands?: string[]
  maxInstallments?: number
}

export type GatewayConnection = {
  id: string
  name: string
  provider: string
  status: 'pending' | 'connected' | 'disconnected' | 'error'
  capabilities: GatewayCapability
  publicConfig: Record<string, unknown>
}

export type PaymentFlowStep = {
  id: string
  gatewayConnectionId: string
  stepOrder: number
  method: PaymentMethod
  action: RoutingAction
  conditions: RoutingConditions
  retryableStatuses: string[]
  maxAttempts: number
  enabled: boolean
}

export type PaymentFlow = {
  id: string
  funnelId: string
  versionId: string
  version: number
  status: 'draft' | 'published' | 'archived'
  steps: PaymentFlowStep[]
}

export type RoutingDecision = {
  step: PaymentFlowStep
  reason: 'condition_match' | 'fallback'
}

export type ProviderPaymentRequest = {
  intentId: string
  idempotencyKey: string
  amount: number
  currency: string
  method: PaymentMethod
  metadata: Record<string, unknown>
}

export type ProviderPaymentResult = {
  status: PaymentStatus
  externalPaymentId?: string
  externalStatus?: string
  errorCode?: string
  errorMessage?: string
  responseMetadata?: Record<string, unknown>
}

export interface PaymentProviderAdapter {
  readonly provider: string
  readonly version: string
  createPayment(request: ProviderPaymentRequest, connection: GatewayConnection): Promise<ProviderPaymentResult>
  healthCheck(connection: GatewayConnection): Promise<{ ok: boolean; latencyMs: number; message?: string }>
}

export class PaymentOsError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, options?: { retryable?: boolean; details?: Record<string, unknown> }) {
    super(message)
    this.name = 'PaymentOsError'
    this.code = code
    this.retryable = options?.retryable ?? false
    this.details = options?.details
  }
}
