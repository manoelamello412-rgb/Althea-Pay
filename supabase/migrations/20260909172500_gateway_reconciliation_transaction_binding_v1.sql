do $$
begin
  if not exists (select 1 from pg_constraint where conname='gateway_transactions_user_id_id_key') then
    alter table public.gateway_transactions add constraint gateway_transactions_user_id_id_key unique (user_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='reconciliation_items_transaction_tenant_fk') then
    alter table public.reconciliation_items
      add constraint reconciliation_items_transaction_tenant_fk
      foreign key (transaction_id,user_id) references public.gateway_transactions(user_id,id);
  end if;
end $$;

create index if not exists idx_reconciliation_items_tenant_transaction
  on public.reconciliation_items(user_id,transaction_id);
create index if not exists idx_reconciliation_items_tenant_external
  on public.reconciliation_items(user_id,external_transaction_id);
