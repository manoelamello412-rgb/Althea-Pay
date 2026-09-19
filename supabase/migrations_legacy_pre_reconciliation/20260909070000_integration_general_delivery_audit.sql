-- Canonical outbound webhook delivery audit already exists as public.outbound_webhook_deliveries.
-- This migration is intentionally limited to its existing production contract: no duplicate logs table.
-- The UI consumes outbound_webhook_deliveries because outbound-webhook-dispatcher writes there.

BEGIN;

-- Reassert the production indexes used by the Integration Center.
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_user_created
  ON public.outbound_webhook_deliveries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_webhook_created
  ON public.outbound_webhook_deliveries (webhook_id, created_at DESC);

ALTER TABLE public.outbound_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbound_webhook_deliveries_select_own
  ON public.outbound_webhook_deliveries;

CREATE POLICY outbound_webhook_deliveries_select_own
  ON public.outbound_webhook_deliveries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

COMMIT;
