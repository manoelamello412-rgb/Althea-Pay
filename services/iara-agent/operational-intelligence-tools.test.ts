import { describe, expect, it, vi } from 'vitest'
import { IaraToolRegistry, registerOperationalIntelligenceTools } from './tool-registry'

const supabase = {} as never

describe('IARA operational intelligence tool registration', () => {
  it('registers forecasting and causal diagnosis as read-only tools', () => {
    const registry = new IaraToolRegistry()
    registerOperationalIntelligenceTools(registry, supabase)

    const forecast = registry.resolve('forecast_metric', 1)
    const causal = registry.resolve('diagnose_metric_causality', 1)

    expect(forecast?.riskClass).toBe('read')
    expect(forecast?.permissionCode).toBe('iara.operational_intelligence.read')
    expect(forecast?.confirmationRequired).toBe(false)
    expect(causal?.riskClass).toBe('read')
    expect(causal?.permissionCode).toBe('iara.operational_intelligence.read')
    expect(registry.listEnabled()).toHaveLength(2)
  })

  it('does not execute intelligence during registration', () => {
    const registry = new IaraToolRegistry()
    registerOperationalIntelligenceTools(registry, supabase)
    expect(vi.isMockFunction(supabase)).toBe(false)
    expect(registry.listEnabled().every((tool) => tool.enabled)).toBe(true)
  })
})
