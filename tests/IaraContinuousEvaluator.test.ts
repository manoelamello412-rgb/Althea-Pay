import { describe, expect, it } from 'vitest'
import { calculateBaseline, classifyAnomaly } from '../services/IaraAnomaliesDetector'
import { evaluateDeterministically } from '../services/IaraContinuousEvaluator'

describe('IARA continuous evaluation contracts', () => {
  it('calculates a baseline without synthetic defaults', () => {
    const baseline = calculateBaseline([100, 100, 100, 100, 110])
    expect(baseline.sampleCount).toBe(5)
    expect(baseline.mean).toBe(102)
    expect(baseline.standardDeviation).toBeGreaterThan(0)
  })

  it('classifies statistically extreme observations using confidence', () => {
    expect(classifyAnomaly(5.5, 0.95)).toBe('CRITICAL')
    expect(classifyAnomaly(4.2, 0.85)).toBe('HIGH')
    expect(classifyAnomaly(3.1, 0.7)).toBe('MEDIUM')
  })

  it('passes a fully grounded deterministic execution', () => {
    const result = evaluateDeterministically({
      tenantId: '00000000-0000-4000-8000-000000000001',
      answer: 'A métrica foi verificada com dados persistidos.',
      evidence: [{ source: 'gateway_transactions', value: 42 }],
      expectedClaims: [{ claim: '42', supported: true }],
      toolCalls: [{ toolKey: 'sales_summary', requestedInput: {}, observedOutput: { total: 42 }, schemaValid: true, authorized: true, resultValid: true }],
      dataConfidence: 0.95,
    })
    expect(result.decision).toBe('PASS')
    expect(result.hallucinationRisk).toBeLessThanOrEqual(0.1)
  })

  it('blocks unsupported claims or invalid tool results', () => {
    const result = evaluateDeterministically({
      tenantId: '00000000-0000-4000-8000-000000000001',
      answer: 'A ação foi executada com sucesso.',
      evidence: [],
      expectedClaims: [{ claim: 'ação executada', supported: false }],
      toolCalls: [{ toolKey: 'unknown_tool', requestedInput: {}, schemaValid: false, authorized: false, resultValid: false }],
    })
    expect(result.decision).toBe('BLOCK')
    expect(result.hallucinationRisk).toBeGreaterThanOrEqual(0.5)
  })

  it('never treats correlation alone as causal confidence', () => {
    const result = evaluateDeterministically({
      tenantId: '00000000-0000-4000-8000-000000000001',
      answer: 'Há associação temporal, mas a causa não foi estabelecida.',
      evidence: [{ source: 'telemetry', value: 1 }],
      expectedClaims: [{ claim: 'associação temporal', supported: true }],
      toolCalls: [],
    })
    expect(result.causalConfidence).toBe(0)
  })
})
