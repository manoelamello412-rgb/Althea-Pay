create or replace function public.enforce_gateway_financial_journal_tenant_integrity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.gateways g where g.id=new.gateway_id and g.user_id=new.user_id) then
    raise exception 'gateway does not belong to journal tenant';
  end if;
  if not exists (select 1 from public.gateway_transactions t where t.id=new.transaction_id and t.user_id=new.user_id and t.gateway_id=new.gateway_id) then
    raise exception 'transaction does not belong to journal tenant and gateway';
  end if;
  return new;
end $$;

drop trigger if exists trg_gateway_financial_journal_tenant on public.gateway_financial_journals;
create trigger trg_gateway_financial_journal_tenant before insert or update on public.gateway_financial_journals for each row execute function public.enforce_gateway_financial_journal_tenant_integrity();

create or replace function public.enforce_gateway_financial_entry_integrity()
returns trigger language plpgsql security definer set search_path=public as $$
declare j_currency text; j_user uuid;
begin
  select currency,user_id into j_currency,j_user from public.gateway_financial_journals where id=new.journal_id for share;
  if j_user is null or j_user<>new.user_id then raise exception 'journal tenant mismatch'; end if;
  if j_currency<>new.currency then raise exception 'entry currency must equal journal currency'; end if;
  if tg_op='UPDATE' or tg_op='DELETE' then raise exception 'financial entries are immutable'; end if;
  return new;
end $$;

drop trigger if exists trg_gateway_financial_entry_integrity on public.gateway_financial_entries;
create trigger trg_gateway_financial_entry_integrity before insert or update or delete on public.gateway_financial_entries for each row execute function public.enforce_gateway_financial_entry_integrity();

create or replace function public.enforce_gateway_financial_journal_immutability()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'financial journals are immutable'; end if;
  if old.status='posted' and (new.user_id,new.transaction_id,new.gateway_id,new.journal_type,new.source_event_key,new.currency,new.metadata) is distinct from (old.user_id,old.transaction_id,old.gateway_id,old.journal_type,old.source_event_key,old.currency,old.metadata) then
    raise exception 'posted financial journal is immutable';
  end if;
  if old.status='voided' and new.status<>old.status then raise exception 'voided financial journal is immutable'; end if;
  return new;
end $$;

drop trigger if exists trg_gateway_financial_journal_immutability on public.gateway_financial_journals;
create trigger trg_gateway_financial_journal_immutability before update or delete on public.gateway_financial_journals for each row execute function public.enforce_gateway_financial_journal_immutability();

create or replace function public.enforce_gateway_financial_journal_balance()
returns trigger language plpgsql security definer set search_path=public as $$
declare debit_total numeric; credit_total numeric; entry_count integer;
begin
  if new.status='posted' then
    select count(*),coalesce(sum(amount) filter(where direction='debit'),0),coalesce(sum(amount) filter(where direction='credit'),0)
      into entry_count,debit_total,credit_total
      from public.gateway_financial_entries where journal_id=new.id;
    if entry_count<2 or debit_total<>credit_total then raise exception 'posted journal must have at least two balanced entries'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_gateway_financial_journal_balance on public.gateway_financial_journals;
create constraint trigger trg_gateway_financial_journal_balance after insert or update on public.gateway_financial_journals deferrable initially deferred for each row execute function public.enforce_gateway_financial_journal_balance();

create or replace function public.enforce_gateway_financial_entry_parent_state()
returns trigger language plpgsql security definer set search_path=public as $$
declare s text;
begin
 select status into s from public.gateway_financial_journals where id=coalesce(new.journal_id,old.journal_id);
 if s is null then raise exception 'financial journal not found'; end if;
 if s in ('posted','voided') then raise exception 'cannot mutate entries of posted or voided journal'; end if;
 return coalesce(new,old);
end $$;

drop trigger if exists trg_gateway_financial_entry_parent_state on public.gateway_financial_entries;
create trigger trg_gateway_financial_entry_parent_state before insert or update or delete on public.gateway_financial_entries for each row execute function public.enforce_gateway_financial_entry_parent_state();

revoke insert,update,delete,truncate on public.gateway_financial_journals from anon,authenticated;
revoke insert,update,delete,truncate on public.gateway_financial_entries from anon,authenticated;
revoke all on function public.enforce_gateway_financial_journal_tenant_integrity() from public,anon,authenticated;
revoke all on function public.enforce_gateway_financial_entry_integrity() from public,anon,authenticated;
revoke all on function public.enforce_gateway_financial_journal_immutability() from public,anon,authenticated;
revoke all on function public.enforce_gateway_financial_journal_balance() from public,anon,authenticated;
revoke all on function public.enforce_gateway_financial_entry_parent_state() from public,anon,authenticated;
