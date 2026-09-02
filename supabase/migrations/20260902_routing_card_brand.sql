alter table public.transaction_routing_logs add column if not exists card_brand varchar(32);
create index if not exists idx_transaction_routing_logs_user_brand_created on public.transaction_routing_logs(user_id, card_brand, created_at desc);
