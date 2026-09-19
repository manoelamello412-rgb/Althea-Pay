alter table public.gateway_payment_attempts add column if not exists transaction_id uuid;
create index if not exists idx_gateway_payment_attempts_tenant_transaction on public.gateway_payment_attempts(user_id,transaction_id,created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='gateway_payment_attempts_transaction_tenant_fk') then
    alter table public.gateway_payment_attempts add constraint gateway_payment_attempts_transaction_tenant_fk foreign key (transaction_id,user_id) references public.gateway_transactions(id,user_id) on delete set null;
  end if;
end $$;
create or replace function public.link_gateway_attempt_to_transaction() returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.gateway_payment_attempts set transaction_id=new.id, updated_at=now()
   where user_id=new.user_id and transaction_id is null and external_transaction_id is not null and external_transaction_id=new.external_id;
  return new;
end;
$$;
drop trigger if exists trg_link_gateway_attempt_to_transaction on public.gateway_transactions;
create trigger trg_link_gateway_attempt_to_transaction after insert on public.gateway_transactions for each row execute function public.link_gateway_attempt_to_transaction();
revoke execute on function public.link_gateway_attempt_to_transaction() from public,anon,authenticated;
grant execute on function public.link_gateway_attempt_to_transaction() to service_role;
