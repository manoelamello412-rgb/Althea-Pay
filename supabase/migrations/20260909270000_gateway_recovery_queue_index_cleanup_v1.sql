-- Keep recovery queue uniqueness canonical and remove the obsolete partial index.
-- gateway_recovery_queue uses uq_gateway_recovery_queue_attempt as the single attempt identity guard.
DROP INDEX IF EXISTS public.uq_gateway_recovery_active_attempt;
