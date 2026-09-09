import type {
  IaraAuthorizationDecision,
  IaraRiskClass,
  IaraToolDefinition,
} from './contracts'

const RISK_ORDER: Record<IaraRiskClass, number> = {
  read: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export interface IaraAuthorizationPolicy {
  allowedPermissionCodes: ReadonlySet<string>
  maxRiskClass: IaraRiskClass
  allowMutations: boolean
}

export function authorizeTool(
  tool: Pick<IaraToolDefinition, 'permissionCode' | 'riskClass' | 'confirmationRequired'>,
  policy: IaraAuthorizationPolicy,
): IaraAuthorizationDecision {
  if (!policy.allowedPermissionCodes.has(tool.permissionCode)) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: 'Permission denied for the requested IARA tool.',
    }
  }

  if (RISK_ORDER[tool.riskClass] > RISK_ORDER[policy.maxRiskClass]) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: 'The requested tool exceeds the maximum risk allowed by policy.',
    }
  }

  if (tool.riskClass !== 'read' && !policy.allowMutations) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: 'State-changing IARA operations are disabled by policy.',
    }
  }

  const requiresConfirmation =
    tool.confirmationRequired || tool.riskClass === 'medium' || tool.riskClass === 'high' || tool.riskClass === 'critical'

  return {
    allowed: true,
    requiresConfirmation,
    reason: requiresConfirmation
      ? 'Tool is authorized but requires the applicable approval policy before execution.'
      : 'Tool is authorized for execution.',
  }
}
