create or replace function public.gateway_attempt_transaction_link_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transaction_id is null then
    raise exception 'gateway_attempt_transaction_required';
  end if;
  if not exists (
    select 1 from public.gateway_transactions t
    where t.id = new.transaction_id
      and t.user_id = new.user_id
  ) then
    raise exception 'gateway_attempt_transaction_tenant_mismatch';
  end if;
  return new;
end;
$$;
revoke all on function public.gateway_attempt_transaction_link_integrity() from public, anon, authenticated;
grant execute on function public.gateway_attempt_transaction_link_integrity() to service_role;
drop trigger if exists trg_gateway_attempt_transaction_link_integrity on public.gateway_payment_attempts;
create trigger trg_gateway_attempt_transaction_link_integrity
before insert or update of transaction_id, user_id on public.gateway_payment_attempts
for each row execute function public.gateway_attempt_transaction_link_integrity();
