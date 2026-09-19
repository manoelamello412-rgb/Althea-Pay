-- Remove duplicate attempt-order validation; keep the canonical named constraint.
ALTER TABLE public.gateway_payment_attempts
  DROP CONSTRAINT IF EXISTS gateway_payment_attempts_attempt_order_check;
