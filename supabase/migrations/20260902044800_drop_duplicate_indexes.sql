-- Remove duplicate indexes (keep one of each pair)
DROP INDEX IF EXISTS public.idx_api_keys_user_active;
DROP INDEX IF EXISTS public.attribution_sessions_last_seen_idx;
DROP INDEX IF EXISTS public.idx_checkout_events_checkout_created;
DROP INDEX IF EXISTS public.idx_checkout_sessions_user_status_created;
DROP INDEX IF EXISTS public.gateway_operations_user_created_idx;
DROP INDEX IF EXISTS public.gateway_transactions_external_user_idx;
DROP INDEX IF EXISTS public.idx_gateway_transactions_user_status_created;
DROP INDEX IF EXISTS public.idempotency_keys_scope_unique;
DROP INDEX IF EXISTS public.integration_events_funnel_time_idx;
DROP INDEX IF EXISTS public.idx_integration_events_user_status_created;