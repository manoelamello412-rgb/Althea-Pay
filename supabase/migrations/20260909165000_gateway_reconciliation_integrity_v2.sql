alter table public.reconciliation_items add column if not exists provider_event_id text;
alter table public.reconciliation_items add column if not exists provider_fee numeric;
alter table public.reconciliation_items add column if not exists settled_at timestamptz;
alter table public.reconciliation_items add constraint reconciliation_items_provider_fee_ck check (provider_fee is null or provider_fee >= 0);
create index if not exists idx_reconciliation_items_external on public.reconciliation_items(user_id,external_transaction_id);
create index if not exists idx_reconciliation_items_status on public.reconciliation_items(user_id,status,updated_at desc);
alter table public.settlements add constraint settlements_totals_ck_v2 check (gross_total >= 0 and fees_total >= 0 and net_total >= 0 and discrepancy_amount is not null);
create unique index if not exists settlements_user_gateway_external_uk on public.settlements(user_id,gateway_id,external_settlement_id) where external_settlement_id is not null;
