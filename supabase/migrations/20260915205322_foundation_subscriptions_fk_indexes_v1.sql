-- Foundation: covering indexes for all subscription foreign keys.
create index if not exists subscriptions_customer_tenant_fk_idx on public.subscriptions (user_id, customer_id);
create index if not exists subscriptions_funnel_fk_idx on public.subscriptions (funnel_id);
create index if not exists subscriptions_gateway_fk_idx on public.subscriptions (gateway_id);
create index if not exists subscriptions_product_fk_idx on public.subscriptions (product_id);
create index if not exists subscriptions_transaction_fk_idx on public.subscriptions (transaction_id);
