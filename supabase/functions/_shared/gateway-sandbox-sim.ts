// Shared, deterministic sandbox payment simulator.
// This module never handles or stores PAN/CVC.

export type SandboxScenario = 'approved' | 'declined' | 'error' | 'refund' | 'chargeback'

export type SandboxResult = {
  status: SandboxScenario
  id: string
  amount: number
  currency: string
  gateway: 'sandbox'
  reason?: string
  retryable: boolean
}

function stableId(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `sb_tx_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function simulateSandboxPayment(
  payload: Record<string, unknown> = {},
  opts?: { forceScenario?: SandboxScenario },
): SandboxResult {
  const scenario = (opts?.forceScenario ?? payload.scenario ?? 'approved') as SandboxScenario
  const amount = Number(payload.amount ?? 0)
  const currency = String(payload.currency ?? 'BRL').toUpperCase()
  const idempotencyKey = String(payload.idempotency_key ?? payload.idempotencyKey ?? `${scenario}:${amount}:${currency}`)
  const id = stableId(idempotencyKey)

  switch (scenario) {
    case 'approved':
      return { status: scenario, id, amount, currency, gateway: 'sandbox', retryable: false }
    case 'declined':
      return { status: scenario, id, amount, currency, gateway: 'sandbox', reason: 'card_declined', retryable: false }
    case 'error':
      return { status: scenario, id, amount, currency, gateway: 'sandbox', reason: 'technical_error', retryable: true }
    case 'refund':
      return { status: scenario, id, amount, currency, gateway: 'sandbox', retryable: false }
    case 'chargeback':
      return { status: scenario, id, amount, currency, gateway: 'sandbox', retryable: false }
    default:
      return { status: 'error', id, amount, currency, gateway: 'sandbox', reason: 'unknown_scenario', retryable: true }
  }
}
