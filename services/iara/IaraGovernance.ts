import { z } from 'zod';

export const IaraRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type IaraRiskLevel = z.infer<typeof IaraRiskLevelSchema>;

export const IaraActionModeSchema = z.enum(['automatic', 'confirm', 'blocked']);
export type IaraActionMode = z.infer<typeof IaraActionModeSchema>;

export const IaraResourceSchema = z.enum([
  'dashboard',
  'sales',
  'customers',
  'products',
  'checkouts',
  'funnels',
  'payments',
  'gateways',
  'affiliates',
  'metrics',
  'reports',
  'crm',
  'conversations',
  'automations',
  'financial_data',
  'integrations',
  'operational_settings',
  'code',
  'infrastructure',
  'secrets',
]);
export type IaraResource = z.infer<typeof IaraResourceSchema>;

export interface IaraAuthorizationContext {
  userId: string;
  tenantId: string;
  roles: readonly string[];
  permissions: readonly string[];
  resource: IaraResource;
}

export interface IaraActionDescriptor {
  action: string;
  resource: IaraResource;
  risk: IaraRiskLevel;
  reversible: boolean;
  financialImpact: boolean;
  destructive: boolean;
  requiresExplicitConfirmation: boolean;
}

export interface IaraGovernanceDecision {
  mode: IaraActionMode;
  reasons: readonly string[];
}

/**
 * Governança é um segundo perímetro além do modelo. O LLM nunca pode
 * transformar uma intenção em autorização. A ferramenta/backend continua
 * sendo responsável pela autorização final.
 */
export function evaluateIaraAction(action: IaraActionDescriptor): IaraGovernanceDecision {
  if (action.resource === 'code' || action.resource === 'infrastructure' || action.resource === 'secrets') {
    return {
      mode: 'blocked',
      reasons: ['IARA possui autonomia operacional, mas autonomia zero sobre código e infraestrutura.'],
    };
  }

  if (action.destructive || action.financialImpact || action.risk === 'critical') {
    return {
      mode: 'confirm',
      reasons: ['A ação pode produzir impacto financeiro, destrutivo ou irreversível.'],
    };
  }

  if (action.risk === 'high' || action.requiresExplicitConfirmation || !action.reversible) {
    return {
      mode: 'confirm',
      reasons: ['A ação exige validação explícita antes da execução.'],
    };
  }

  return {
    mode: 'automatic',
    reasons: ['A ação é operacional, autorizável e reversível dentro do escopo permitido.'],
  };
}

export function assertIaraAuthorization(
  context: IaraAuthorizationContext,
  action: IaraActionDescriptor,
): void {
  if (context.resource !== action.resource) {
    throw new Error('[IARA_AUTHORIZATION_DENIED] Recurso fora do contexto autorizado.');
  }

  if (action.resource === 'code' || action.resource === 'infrastructure' || action.resource === 'secrets') {
    throw new Error('[IARA_FORBIDDEN_CAPABILITY] IARA não pode operar sobre código, infraestrutura ou segredos.');
  }
}
