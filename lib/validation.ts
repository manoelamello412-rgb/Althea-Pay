import { z } from 'zod'

const JsonRecord = z.record(z.string(), z.unknown())

export const ChargeSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  merchant_id: z.string().uuid().optional(),
  metadata: JsonRecord.optional(),
  idempotency_key: z.string().min(1).optional(),
})

export const WebhookEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: JsonRecord.optional(),
})

export type Charge = z.infer<typeof ChargeSchema>
export type WebhookEvent = z.infer<typeof WebhookEventSchema>
