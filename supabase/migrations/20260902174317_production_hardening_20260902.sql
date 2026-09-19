create extension if not exists pgcrypto;

create index if not exists idx_gateway_payment_attempts_user_gateway_created on public.gateway_payment_attempts (user_id, gateway_id, created_at desc);
create index if not exists idx_gateway_payment_attempts_user_status_created on public.gateway_payment_attempts (user_id, status, created_at desc);
create index if not exists idx_outbound_webhook_deliveries_user_status_retry on public.outbound_webhook_deliveries (user_id, status, next_retry_at);

alter table public.gateway_payment_attempts enable row level security;
alter table public.outbound_webhook_deliveries enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.reconciliation_runs enable row level security;

revoke insert, update, delete on public.gateway_payment_attempts from authenticated;
revoke insert, update, delete on public.outbound_webhook_deliveries from authenticated;
revoke insert, update, delete on public.reconciliation_items from authenticated;
revoke insert, update, delete on public.reconciliation_runs from authenticated;

-- Defense in depth: users can only read their own operational records.
drop policy if exists gateway_payment_attempts_select_own on public.gateway_payment_attempts;
create policy gateway_payment_attempts_select_own on public.gateway_payment_attempts for select to authenticated using (user_id = auth.uid());

drop policy if exists outbound_webhook_deliveries_select_own on public.outbound_webhook_deliveries;
create policy outbound_webhook_deliveries_select_own on public.outbound_webhook_deliveries for select to authenticated using (user_id = auth.uid());

drop policy if exists reconciliation_items_owner_read on public.reconciliation_items;
create policy reconciliation_items_owner_read on public.reconciliation_items for select to authenticated using (user_id = auth.uid());

drop policy if exists reconciliation_runs_owner_read on public.reconciliation_runs;
create policy reconciliation_runs_owner_read on public.reconciliation_runs for select to authenticated using (user_id = auth.uid());