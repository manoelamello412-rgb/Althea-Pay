export interface FinancialAuditInput {
  gross: bigint
  subtotal: bigint
  discount: bigint
  fee: bigint
  commission: bigint
  margin: bigint
  conversionNumerator: bigint
  conversionDenominator: bigint
  averageTicketNumerator: bigint
  averageTicketDenominator: bigint
  roiNumerator: bigint
  roiDenominator: bigint
  netRevenue: bigint
  chargeback: bigint
  payout: bigint
  balance: bigint
  evidenceGraphConsistent: boolean
}

export interface FinancialAuditResult {
  ok: boolean
  signal: 'AUDIT_OK' | 'AUDIT_INCONSISTENCY'
  reasons: string[]
}

function nonNegative(value: bigint): boolean {
  return value >= 0n
}

export function auditFinancialSnapshot(input: FinancialAuditInput): FinancialAuditResult {
  const reasons: string[] = []
  const calculatedNet = input.gross - input.discount - input.fee - input.commission - input.chargeback
  const calculatedMargin = input.netRevenue - input.payout
  const calculatedBalance = input.payout - input.chargeback

  if (input.subtotal !== input.gross - input.discount) reasons.push('SUBTOTAL_MISMATCH')
  if (input.netRevenue !== calculatedNet) reasons.push('NET_REVENUE_MISMATCH')
  if (input.margin !== calculatedMargin) reasons.push('MARGIN_MISMATCH')
  if (input.balance !== calculatedBalance) reasons.push('BALANCE_MISMATCH')
  if (input.conversionDenominator === 0n && input.conversionNumerator !== 0n) reasons.push('CONVERSION_DENOMINATOR_INVALID')
  if (input.averageTicketDenominator === 0n && input.averageTicketNumerator !== 0n) reasons.push('AVERAGE_TICKET_DENOMINATOR_INVALID')
  if (input.roiDenominator === 0n && input.roiNumerator !== 0n) reasons.push('ROI_DENOMINATOR_INVALID')

  const numericFields: Array<[string, bigint]> = [
    ['gross', input.gross],
    ['subtotal', input.subtotal],
    ['discount', input.discount],
    ['fee', input.fee],
    ['commission', input.commission],
    ['margin', input.margin],
    ['netRevenue', input.netRevenue],
    ['chargeback', input.chargeback],
    ['payout', input.payout],
    ['balance', input.balance],
  ]
  for (const [name, value] of numericFields) if (!nonNegative(value)) reasons.push(`${name.toUpperCase()}_NEGATIVE`)
  if (!input.evidenceGraphConsistent) reasons.push('EVIDENCE_GRAPH_INCONSISTENT')

  return reasons.length === 0
    ? { ok: true, signal: 'AUDIT_OK', reasons: [] }
    : { ok: false, signal: 'AUDIT_INCONSISTENCY', reasons }
}
