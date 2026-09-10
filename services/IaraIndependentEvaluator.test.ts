import { describe, expect, it, vi } from 'vitest'
import { GateContext, IaraIndependentEvaluator, EvaluationVerdict } from './IaraIndependentEvaluator'

function mockSupabase(options?: {
  transaction?: Record<string, unknown> | null
  product?: Record<string, unknown> | null
  member?: boolean
}) {
  const transaction = options?.transaction ?? null
  const product = options?.product ?? null
  const member = options?.member ?? true
  const builder = (table: string) => {
    const state = { table, filters: [] as Array<[string, string, unknown]> }
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => { state.filters.push(['eq', column, value]); return chain }),
      or: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === 'gateway_transactions') return { data: transaction, error: null }
        if (table === 'products') return { data: product, error: null }
        return { data: member ? [{ organization_id: state.filters.find((item) => item[1] === 'organization_id')?.[2] }] : [], error: null }
      }),
    }
    return chain
  }
  return {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async () => ({ data: crypto.randomUUID(), error: null })),
  } as never
}

const tenantId = '11111111-1111-4111-8111-111111111111'
const txId = 'tx_8849201a'

const transaction = {
  id: txId,
  user_id: '22222222-2222-4222-8222-222222222222',
  product_id: 'prod_901',
  amount: 1450,
  currency: 'BRL',
  status: 'PAID',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
}

const baseOutput = {
  tenantId,
  invokedTool: null,
  toolPayloadStr: null,
  latencyMs: 20,
}

describe('IaraIndependentEvaluator', () => {
  it('blocks an operational response with an unknown transaction', async () => {
    const evaluator = new IaraIndependentEvaluator(mockSupabase())
    const report = await evaluator.auditIaraOutput({ ...baseOutput, responseText: `A transação ${txId} foi paga.` }, GateContext.OPERATIONAL)
    expect(report.verdict).toBe(EvaluationVerdict.BLOCK)
    expect(report.failures.some((item) => item.failureCode === 'ENTITY_NOT_FOUND')).toBe(true)
  })

  it('blocks a financial response when the amount diverges from the ledger', async () => {
    const evaluator = new IaraIndependentEvaluator(mockSupabase({ transaction }))
    const report = await evaluator.auditIaraOutput({ ...baseOutput, responseText: `A transação ${txId} foi concluída por R$ 1.450,01.` }, GateContext.FINANCIAL)
    expect(report.verdict).toBe(EvaluationVerdict.BLOCK)
    expect(report.failures.some((item) => item.failureCode === 'NUMERIC_MISMATCH')).toBe(true)
  })

  it('blocks a cross-tenant entity even when the record exists', async () => {
    const evaluator = new IaraIndependentEvaluator(mockSupabase({ transaction, member: false }))
    const report = await evaluator.auditIaraOutput({ ...baseOutput, responseText: `A transação ${txId} pertence a este tenant.` }, GateContext.FINANCIAL)
    expect(report.verdict).toBe(EvaluationVerdict.BLOCK)
    expect(report.scores.tenantIsolationSecurity).toBe(0)
    expect(report.failures.some((item) => item.failureCode === 'TENANT_ISOLATION_VIOLATION')).toBe(true)
  })

  it('blocks unauthorized tool calls regardless of response wording', async () => {
    const evaluator = new IaraIndependentEvaluator(mockSupabase())
    const report = await evaluator.auditIaraOutput({
      ...baseOutput,
      responseText: 'Operação concluída.',
      toolCalls: [{ toolKey: 'financial.write', requestedInput: {}, schemaValid: true, authorized: false, resultValid: true }],
    }, GateContext.OPERATIONAL)
    expect(report.verdict).toBe(EvaluationVerdict.BLOCK)
    expect(report.failures.some((item) => item.failureCode === 'UNAUTHORIZED_TOOL_CALL')).toBe(true)
  })

  it('reviews an ungrounded read instead of silently passing it', async () => {
    const evaluator = new IaraIndependentEvaluator(mockSupabase())
    const report = await evaluator.auditIaraOutput({ ...baseOutput, responseText: 'As vendas melhoraram.' }, GateContext.READ)
    expect(report.verdict).toBe(EvaluationVerdict.REVIEW)
    expect(report.scores.groundingFactCheck).toBe(0)
  })

  it('rejects mathematically invalid percentages', async () => {
    const evaluator = new IaraIndependentEvaluator(mockSupabase())
    const report = await evaluator.auditIaraOutput({ ...baseOutput, responseText: 'A conversão atual é 140%.' }, GateContext.FINANCIAL)
    expect(report.verdict).toBe(EvaluationVerdict.BLOCK)
    expect(report.failures.some((item) => item.failureCode === 'INVALID_PERCENTAGE')).toBe(true)
  })
})
