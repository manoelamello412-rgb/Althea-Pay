-- Gateway attempt integrity: every payment attempt must belong to a canonical transaction.
-- The production orchestrator creates the transaction before inserting its attempt.
-- Refuse the migration if any legacy orphan attempts exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.gateway_payment_attempts
    WHERE transaction_id IS NULL
  ) THEN
    RAISE EXCEPTION 'gateway_attempt_transaction_id_null_rows_exist';
  END IF;
END $$;

ALTER TABLE public.gateway_payment_attempts
  ALTER COLUMN transaction_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gateway_payment_attempts_transaction_tenant
  ON public.gateway_payment_attempts(user_id, transaction_id, attempt_order);
