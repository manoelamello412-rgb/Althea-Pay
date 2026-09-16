-- Stage 6: consolidate duplicate transaction indexes
 drop index if exists public.gateway_transactions_org_idempotency_uidx;
 drop index if exists public.gateway_transactions_product_idx;
