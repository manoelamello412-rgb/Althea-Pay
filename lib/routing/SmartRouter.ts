export type GatewayProvider = string
export type RoutingStatus = 'SUCCESS' | 'FALLBACK_TRIGGERED' | 'CIRCUIT_OPEN' | 'CRITICAL_FAILURE'
export type FailureClass = 'technical' | 'timeout' | 'unavailable' | 'declined' | 'fraud' | 'pending' | 'unknown'
export type CircuitState = 'closed' | 'open' | 'half_open'

export interface PaymentPayload {
  transactionId: string
  tenantId: string
  amount: number
  currency: string
  paymentToken: string
  metadata?: Record<string, unknown>
}

export interface GatewayExecutionResult {
  id?: string
  status?: string
  httpStatus?: number
  latencyMs?: number
  failureClass?: FailureClass
  error?: string
}

export interface RoutingResult {
  status: RoutingStatus
  providerUsed: GatewayProvider
  gatewayTransactionId?: string
  error?: string
  attemptsCount: number
  providerAttempts: Array<{
    provider: GatewayProvider
    attempt: number
    outcome: 'approved' | 'failed' | 'skipped'
    failureClass?: FailureClass
    latencyMs?: number
    error?: string
  }>
}

export interface CircuitDecision {
  allowed: boolean
  state: CircuitState
  failureCount: number
  probeToken?: string
}

export interface CircuitStore {
  beforeAttempt(tenantId: string, provider: GatewayProvider): Promise<CircuitDecision>
  recordSuccess(tenantId: string, provider: GatewayProvider, probeToken?: string): Promise<void>
  recordFailure(tenantId: string, provider: GatewayProvider, failure: FailureClass, probeToken?: string): Promise<void>
}

export interface SmartRouterOptions {
  failureThreshold?: number
  cooldownPeriodMs?: number
  maxRetriesPerProvider?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
  jitterRatio?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULTS = {
  failureThreshold: 3,
  cooldownPeriodMs: 30_000,
  maxRetriesPerProvider: 1,
  baseBackoffMs: 150,
  maxBackoffMs: 1_500,
  jitterRatio: 0.25,
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class InMemoryCircuitStore implements CircuitStore {
  private readonly states = new Map<string, { failureCount: number; state: CircuitState; openedAt: number; probeUntil: number }>()
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly probeLeaseMs: number

  constructor(threshold = DEFAULTS.failureThreshold, cooldownMs = DEFAULTS.cooldownPeriodMs, probeLeaseMs = 5_000) {
    this.threshold = threshold
    this.cooldownMs = cooldownMs
    this.probeLeaseMs = probeLeaseMs
  }

  async beforeAttempt(tenantId: string, provider: GatewayProvider): Promise<CircuitDecision> {
    const key = `${tenantId}:${provider}`
    const now = Date.now()
    const current = this.states.get(key) ?? { failureCount: 0, state: 'closed' as CircuitState, openedAt: 0, probeUntil: 0 }
    if (current.state === 'open') {
      if (now - current.openedAt < this.cooldownMs) return { allowed: false, state: 'open', failureCount: current.failureCount }
      if (current.probeUntil > now) return { allowed: false, state: 'half_open', failureCount: current.failureCount }
      current.state = 'half_open'
      current.probeUntil = now + this.probeLeaseMs
      this.states.set(key, current)
      return { allowed: true, state: 'half_open', failureCount: current.failureCount, probeToken: `${key}:${now}` }
    }
    if (current.state === 'half_open' && current.probeUntil > now) return { allowed: false, state: 'half_open', failureCount: current.failureCount }
    return { allowed: true, state: current.state, failureCount: current.failureCount }
  }

  async recordSuccess(tenantId: string, provider: GatewayProvider): Promise<void> {
    this.states.set(`${tenantId}:${provider}`, { failureCount: 0, state: 'closed', openedAt: 0, probeUntil: 0 })
  }

  async recordFailure(tenantId: string, provider: GatewayProvider, _failure: FailureClass): Promise<void> {
    const key = `${tenantId}:${provider}`
    const current = this.states.get(key) ?? { failureCount: 0, state: 'closed' as CircuitState, openedAt: 0, probeUntil: 0 }
    current.failureCount += 1
    current.openedAt = Date.now()
    current.probeUntil = 0
    current.state = current.failureCount >= this.threshold ? 'open' : 'closed'
    this.states.set(key, current)
  }
}

export class SmartRouter {
  private readonly options: Required<SmartRouterOptions>
  private readonly gatewaysPriorityList: GatewayProvider[]
  private readonly gatewayExecutors: Record<GatewayProvider, (payload: PaymentPayload, attempt: number, idempotencyKey: string) => Promise<GatewayExecutionResult>>
  private readonly circuitStore: CircuitStore

  constructor(
    priorityList: GatewayProvider[],
    executors: Record<GatewayProvider, (payload: PaymentPayload, attempt: number, idempotencyKey: string) => Promise<GatewayExecutionResult>>,
    circuitStore: CircuitStore = new InMemoryCircuitStore(),
    options: SmartRouterOptions = {},
  ) {
    if (!priorityList.length) throw new Error('A lista de prioridade de gateways não pode estar vazia.')
    const unique = [...new Set(priorityList.map((provider) => provider.trim().toLowerCase()))]
    if (unique.some((provider) => !provider || !executors[provider])) throw new Error('Todos os gateways priorizados precisam de um executor configurado.')
    this.gatewaysPriorityList = unique
    this.gatewayExecutors = executors
    this.circuitStore = circuitStore
    this.options = {
      ...DEFAULTS,
      ...options,
      sleep: options.sleep ?? sleep,
    }
  }

  public async routeAndExecute(payload: PaymentPayload): Promise<RoutingResult> {
    this.validatePayload(payload)
    const attempts: RoutingResult['providerAttempts'] = []
    let totalAttempts = 0
    let lastFailure: FailureClass = 'unknown'
    let lastError = 'Todos os gateways priorizados falharam.'

    for (const provider of this.gatewaysPriorityList) {
      const decision = await this.circuitStore.beforeAttempt(payload.tenantId, provider)
      if (!decision.allowed) {
        attempts.push({ provider, attempt: 0, outcome: 'skipped', error: `circuit_${decision.state}` })
        continue
      }

      const maxAttempts = this.options.maxRetriesPerProvider + 1
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        totalAttempts += 1
        const idempotencyKey = `${payload.transactionId}:${provider}:${attempt}`
        const started = Date.now()
        try {
          const result = await this.gatewayExecutors[provider](payload, attempt, idempotencyKey)
          const latencyMs = result.latencyMs ?? Date.now() - started
          if (this.isSuccess(result)) {
            await this.circuitStore.recordSuccess(payload.tenantId, provider, decision.probeToken)
            attempts.push({ provider, attempt, outcome: 'approved', latencyMs })
            return {
              status: totalAttempts > 1 ? 'FALLBACK_TRIGGERED' : 'SUCCESS',
              providerUsed: provider,
              gatewayTransactionId: result.id,
              attemptsCount: totalAttempts,
              providerAttempts: attempts,
            }
          }

          const failure = result.failureClass ?? this.classifyFailure(result.httpStatus, result.error)
          const canRetry = this.isRetryable(failure) && attempt < maxAttempts
          lastFailure = failure
          lastError = result.error ?? `gateway_${failure}`
          attempts.push({ provider, attempt, outcome: 'failed', failureClass: failure, latencyMs, error: lastError })

          if (!this.isRetryable(failure)) {
            return { status: 'CRITICAL_FAILURE', providerUsed: provider, error: lastError, attemptsCount: totalAttempts, providerAttempts: attempts }
          }

          await this.circuitStore.recordFailure(payload.tenantId, provider, failure, decision.probeToken)
          if (canRetry) await this.options.sleep(this.backoff(attempt))
        } catch (error) {
          const failure = this.classifyFailure(undefined, error instanceof Error ? error.message : String(error))
          lastFailure = failure
          lastError = error instanceof Error ? error.message : String(error)
          attempts.push({ provider, attempt, outcome: 'failed', failureClass: failure, latencyMs: Date.now() - started, error: lastError })
          await this.circuitStore.recordFailure(payload.tenantId, provider, failure, decision.probeToken)
          if (!this.isRetryable(failure)) return { status: 'CRITICAL_FAILURE', providerUsed: provider, error: lastError, attemptsCount: totalAttempts, providerAttempts: attempts }
          if (attempt < maxAttempts) await this.options.sleep(this.backoff(attempt))
        }
      }
    }

    return {
      status: lastFailure === 'declined' || lastFailure === 'fraud' ? 'CRITICAL_FAILURE' : 'CIRCUIT_OPEN',
      providerUsed: this.gatewaysPriorityList[0],
      error: lastError,
      attemptsCount: totalAttempts,
      providerAttempts: attempts,
    }
  }

  private validatePayload(payload: PaymentPayload): void {
    if (!payload.transactionId || !payload.tenantId || !payload.paymentToken) throw new Error('transactionId, tenantId e paymentToken são obrigatórios.')
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error('amount deve ser um número positivo.')
    if (!/^[A-Za-z]{3}$/.test(payload.currency)) throw new Error('currency deve ser ISO-4217 de três letras.')
  }

  private isSuccess(result: GatewayExecutionResult): boolean {
    return Boolean(result.id) && (!result.status || ['approved', 'success', 'completed'].includes(result.status.toLowerCase()))
  }

  private classifyFailure(status: number | undefined, message = ''): FailureClass {
    const normalized = message.toLowerCase()
    if (normalized.includes('fraud') || normalized.includes('risk')) return 'fraud'
    if (normalized.includes('declin') || normalized.includes('insufficient') || normalized.includes('invalid_card')) return 'declined'
    if (status === 408 || status === 504 || normalized.includes('timeout') || normalized.includes('timed out')) return 'timeout'
    if (status === 429 || (status !== undefined && status >= 500) || normalized.includes('fetch') || normalized.includes('network')) return 'unavailable'
    if (status !== undefined && status >= 400) return 'declined'
    return 'technical'
  }

  private isRetryable(failure: FailureClass): boolean {
    return failure === 'technical' || failure === 'timeout' || failure === 'unavailable'
  }

  private backoff(attempt: number): number {
    const exponential = Math.min(this.options.maxBackoffMs, this.options.baseBackoffMs * 2 ** Math.max(0, attempt - 1))
    const jitter = exponential * this.options.jitterRatio * (Math.random() * 2 - 1)
    return Math.max(0, Math.round(exponential + jitter))
  }
}
