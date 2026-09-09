create or replace function public.gateway_runtime_invariants_guard()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.gateway_id is null or btrim(new.gateway_id)='' then
    raise exception 'gateway_id_required';
  end if;
  if new.amount is null or new.amount <= 0 then
    raise exception 'gateway_amount_invalid';
  end if;
  if new.currency is null or new.currency !~ '^[A-Z]{3}$' then
    raise exception 'gateway_currency_invalid';
  end if;
  if new.attempt_count < 0 then
    raise exception 'gateway_attempt_count_invalid';
  end if;
  if new.version < 1 then
    raise exception 'gateway_transaction_version_invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_gateway_runtime_invariants on public.gateway_transactions;
create trigger trg_gateway_runtime_invariants
before insert or update on public.gateway_transactions
for each row execute function public.gateway_runtime_invariants_guard();

revoke execute on function public.gateway_runtime_invariants_guard() from public, anon, authenticated;
grant execute on function public.gateway_runtime_invariants_guard() to service_role;

create index if not exists idx_gateway_transactions_tenant_external
on public.gateway_transactions(user_id, gateway_id, external_id)
where external_id is not null;

create index if not exists idx_gateway_transactions_tenant_idempotency
on public.gateway_transactions(user_id, idempotency_key);
