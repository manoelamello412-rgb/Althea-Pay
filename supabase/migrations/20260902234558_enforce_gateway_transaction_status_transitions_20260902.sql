create or replace function public.enforce_gateway_transaction_status_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;

  if old.status = 'created' and new.status in ('pending','approved','failed') then
    return new;
  end if;
  if old.status = 'pending' and new.status in ('approved','failed','refunded','chargeback') then
    return new;
  end if;
  if old.status = 'approved' and new.status in ('refunded','chargeback') then
    return new;
  end if;
  if old.status in ('failed','refunded','chargeback') then
    raise exception 'invalid_status_transition: % -> %', old.status, new.status;
  end if;

  raise exception 'invalid_status_transition: % -> %', old.status, new.status;
end;
$$;

revoke all on function public.enforce_gateway_transaction_status_transition() from public;
revoke all on function public.enforce_gateway_transaction_status_transition() from anon;
revoke all on function public.enforce_gateway_transaction_status_transition() from authenticated;

drop trigger if exists trg_enforce_gateway_transaction_status_transition on public.gateway_transactions;
create trigger trg_enforce_gateway_transaction_status_transition
before update of status on public.gateway_transactions
for each row
execute function public.enforce_gateway_transaction_status_transition();
