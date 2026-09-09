import { describe, expect, it, vi } from 'vitest'
import { IaraToolRegistry } from '../../services/iara-agent/registry'
import type { IaraToolContext } from '../../services/iara-agent/contracts'

const context: IaraToolContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
  requestId: '00000000-0000-4000-8000-000000000004',
}

describe('IARA tool governance', () => {
  it('executes an authorized read tool', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })
    const registry = new IaraToolRegistry()
    registry.register({
      key: 'test.read',
      version: 1,
      description: 'test',
      riskClass: 'read',
      permissionCode: 'iara.read',
      idempotencyRequired: false,
      confirmationRequired: false,
      execute,
    })

    const result = await registry.execute(
      { toolKey: 'test.read', version: 1, input: {} },
      context,
      { allowedPermissionCodes: new Set(['iara.read']), maxRiskClass: 'read', allowMutations: false },
    )

    expect(result.status).toBe('completed')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('never executes a state-changing tool without confirmation', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })
    const registry = new IaraToolRegistry()
    registry.register({
      key: 'test.write',
      version: 1,
      description: 'test',
      riskClass: 'medium',
      permissionCode: 'iara.write',
      idempotencyRequired: true,
      confirmationRequired: false,
      execute,
    })

    const result = await registry.execute(
      { toolKey: 'test.write', version: 1, input: {} },
      context,
      { allowedPermissionCodes: new Set(['iara.write']), maxRiskClass: 'medium', allowMutations: true },
    )

    expect(result.status).toBe('awaiting_confirmation')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects tools outside the caller permission set', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true })
    const registry = new IaraToolRegistry()
    registry.register({
      key: 'test.admin',
      version: 1,
      description: 'test',
      riskClass: 'high',
      permissionCode: 'admin.only',
      idempotencyRequired: true,
      confirmationRequired: true,
      execute,
    })

    const result = await registry.execute(
      { toolKey: 'test.admin', version: 1, input: {} },
      context,
      { allowedPermissionCodes: new Set(['iara.read']), maxRiskClass: 'high', allowMutations: true },
    )

    expect(result.status).toBe('failed')
    expect(execute).not.toHaveBeenCalled()
  })
})
