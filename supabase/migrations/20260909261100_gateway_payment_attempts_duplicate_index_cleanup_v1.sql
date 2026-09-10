-- Remove a redundant gateway payment-attempt index identified by the performance audit.
DROP INDEX IF EXISTS public.idx_gateway_payment_attempts_tenant_gateway;
