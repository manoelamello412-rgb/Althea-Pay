drop index if exists public.uq_gateway_payment_attempts_idempotency;
drop index if exists public.uq_gateway_payment_attempts_transaction_order;
drop index if exists public.uq_gateway_attempt_order_per_sale;
create unique index uq_gateway_payment_attempts_org_idempotency on public.gateway_payment_attempts (organization_id, idempotency_key);
create unique index uq_gateway_payment_attempts_org_transaction_order on public.gateway_payment_attempts (organization_id, transaction_id, attempt_order);
create unique index uq_gateway_attempt_order_per_org_sale on public.gateway_payment_attempts (organization_id, sale_id, attempt_order) where sale_id is not null;
