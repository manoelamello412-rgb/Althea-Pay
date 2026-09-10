-- ALTHEA PAY — Multi-Gateway runtime invariants v1
create or replace function public.gateway_runtime_invariants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gateway_id is null or btrim(new.gateway_id) = '' then raise exception 'gateway_id_required' using errcode='23514'; end if;
  if new.amount is null or new.amount <= 0 then raise exception 'gateway_amount_invalid' using errcode='23514'; end if;
  if new.currency is null or new.currency !~ '^[A-Z]{3}$' then raise exception 'gateway_currency_invalid' using errcode='23514'; end if;
  if coalesce(new.attempt_count,0) < 0 then raise exception 'gateway_attempt_count_invalid' using errcode='23514'; end if;
  if coalesce(new.version,1) < 1 then raise exception 'gateway_version_invalid' using errcode='23514'; end if;
  return new;
end; $$;
revoke execute on function public.gateway_runtime_invariants_guard() from public,anon,authenticated;
grant execute on function public.gateway_runtime_invariants_guard() to service_role;
drop trigger if exists trg_gateway_runtime_invariants on public.gateway_transactions;
create trigger trg_gateway_runtime_invariants before insert or update on public.gateway_transactions for each row execute function public.gateway_runtime_invariants_guard();
create index if not exists idx_gateway_transactions_tenant_external on public.gateway_transactions(user_id,gateway_id,external_id) where external_id is not null;
create index if not exists idx_gateway_transactions_tenant_idempotency on public.gateway_transactions(user_id,idempotency_key);
