-- Consolidate equivalent permissive SELECT policies and cover tenant-scoped foreign keys.
-- Semantics are preserved: authenticated users may read a row when they are either
-- a member of its organization or the row's owning user.

drop policy if exists gateway_payment_attempts_org_read on public.gateway_payment_attempts;
drop policy if exists gateway_payment_attempts_select_own on public.gateway_payment_attempts;
create policy gateway_payment_attempts_read
on public.gateway_payment_attempts
for select
to authenticated
using (
  private.is_org_member(organization_id)
  or user_id = (select auth.uid())
);

drop policy if exists gateway_transactions_org_read on public.gateway_transactions;
drop policy if exists gateway_transactions_select_own on public.gateway_transactions;
create policy gateway_transactions_read
on public.gateway_transactions
for select
to authenticated
using (
  private.is_org_member(organization_id)
  or user_id = (select auth.uid())
);

create index if not exists gateway_payment_attempts_transaction_tenant_idx
  on public.gateway_payment_attempts (transaction_id, organization_id);

create index if not exists reconciliation_items_run_tenant_idx
  on public.reconciliation_items (run_id, organization_id);
