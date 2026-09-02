export type FinancialState =
  | 'pending'
  | 'approved'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'chargeback'

const transitions: Record<FinancialState, readonly FinancialState[]> = {
  pending: ['pending', 'approved', 'failed', 'cancelled'],
  approved: ['approved', 'refunded', 'chargeback'],
  failed: ['failed'],
  cancelled: ['cancelled'],
  refunded: ['refunded'],
  chargeback: ['chargeback'],
}

export function normalizeFinancialState(value: unknown): FinancialState | null {
  const state = String(value ?? '').trim().toLowerCase()
  if (state === 'paid' || state === 'completed' || state === 'success') return 'approved'
  if (state === 'declined' || state === 'error') return 'failed'
  if (state === 'refund' || state === 'reversed') return 'refunded'
  if (state === 'charge_back') return 'chargeback'
  return (Object.keys(transitions) as FinancialState[]).includes(state as FinancialState)
    ? (state as FinancialState)
    : null
}

export function canTransitionFinancialState(
  current: unknown,
  next: unknown,
): boolean {
  const from = normalizeFinancialState(current)
  const to = normalizeFinancialState(next)
  if (!to) return false
  if (!from) return true
  return transitions[from].includes(to)
}
