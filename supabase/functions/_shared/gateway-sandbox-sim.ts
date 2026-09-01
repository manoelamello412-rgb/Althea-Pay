// Shared helpers for sandbox simulation

export type SandboxResult = {
  status: 'approved' | 'declined' | 'error' | 'refund' | 'chargeback'
  id: string
  amount: number
  currency: string
  gateway: string
  reason?: string
}

export function simulateSandboxPayment(payload: any, opts?: {forceScenario?: string}) : SandboxResult {
  // Simple deterministic simulation by scenario -> suitable for tests and sandbox
  const scenario = opts?.forceScenario || payload.scenario || 'approved'
  const id = `sb_tx_${Math.random().toString(36).slice(2,10)}`
  const amount = payload.amount || 0
  const currency = payload.currency || 'BRL'
  switch (scenario) {
    case 'approved':
      return { status: 'approved', id, amount, currency, gateway: 'sandbox' }
    case 'declined':
      return { status: 'declined', id, amount, currency, gateway: 'sandbox', reason: 'card_declined' }
    case 'error':
      return { status: 'error', id, amount, currency, gateway: 'sandbox', reason: 'technical_error' }
    case 'refund':
      return { status: 'refund', id, amount, currency, gateway: 'sandbox' }
    case 'chargeback':
      return { status: 'chargeback', id, amount, currency, gateway: 'sandbox' }
    default:
      return { status: 'error', id, amount, currency, gateway: 'sandbox', reason: 'unknown_scenario' }
  }
}
