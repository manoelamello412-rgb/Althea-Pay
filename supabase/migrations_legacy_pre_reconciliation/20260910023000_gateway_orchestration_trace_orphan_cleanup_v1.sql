-- Remove only known synthetic E2E orphan traces.
-- Production traces require a transaction_id; this cleanup is intentionally
-- constrained to the deterministic e2e-trace key prefix used by validation.
DELETE FROM public.gateway_orchestration_traces
WHERE transaction_id IS NULL
  AND idempotency_key LIKE 'e2e-trace-%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.gateway_orchestration_traces
    WHERE transaction_id IS NULL
      AND idempotency_key LIKE 'e2e-trace-%'
  ) THEN
    RAISE EXCEPTION 'gateway_trace_orphan_cleanup_failed';
  END IF;
END $$;
