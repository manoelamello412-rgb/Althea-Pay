DELETE FROM public.gateway_orchestration_traces WHERE transaction_id IS NULL AND idempotency_key LIKE 'e2e-trace-%';
