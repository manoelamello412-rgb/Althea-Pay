import { z } from 'zod';

export const ChargeSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  merchant_id: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
  idempotency_key: z.string().optional(),
});

export const WebhookEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.record(z.any()).optional(),
});

export type Charge = z.infer<typeof ChargeSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
