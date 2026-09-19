create or replace function public.prevent_direct_refunded_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'refunded' then
    raise exception 'invalid_transaction_creation_status' using errcode = '23514', detail = 'Refunds must transition an existing transaction.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_direct_refunded_transaction_insert() from public, anon, authenticated;
grant execute on function public.prevent_direct_refunded_transaction_insert() to service_role;

drop trigger if exists prevent_direct_refunded_transaction_insert on public.gateway_transactions;
create trigger prevent_direct_refunded_transaction_insert
before insert on public.gateway_transactions
for each row execute function public.prevent_direct_refunded_transaction_insert();