import { z } from 'zod'
import type { GatewayCapability, PaymentMethod } from './types'

export const GatewayConnectionConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.string().trim().min(1).max(80),
  baseApiUrl: z.string().url(),
  webhookSecret: z.string().min(1).max(512).optional(),
  authHeader: z.string().trim().min(1).max(120).optional(),
  authPrefix: z.string().max(40).optional(),
  healthEndpoint: z.string().trim().min(1).max(240).optional(),
  publicConfig: z.record(z.string(), z.unknown()).default({}),
  capabilities: z.object({
    methods: z.array(z.enum(['pix', 'credit_card', 'debit_card', 'boleto'])).min(1),
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
    cardBrands: z.array(z.string()).optional(),
    maxInstallments: z.number().int().min(1).max(48).optional(),
  }),
})

export type GatewayConnectionConfig = z.infer<typeof GatewayConnectionConfigSchema>

export function normalizeGatewayConfig(input: GatewayConnectionConfig): GatewayConnectionConfig {
  const parsed = GatewayConnectionConfigSchema.parse(input)
  return {
    ...parsed,
    provider: parsed.provider.toLowerCase(),
    baseApiUrl: parsed.baseApiUrl.replace(/\/$/, ''),
    authPrefix: parsed.authPrefix?.trim() || undefined,
    healthEndpoint: parsed.healthEndpoint?.trim() || undefined,
  }
}

export function supportsPaymentMethod(capability: GatewayCapability, method: PaymentMethod): boolean {
  return capability.methods.includes(method)
}
