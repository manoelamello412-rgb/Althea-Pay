begin;

alter table public.gateway_transactions
  add column if not exists organization_id uuid;

update public.gateway_transactions t
set organization_id = m.organization_id
from public.organization_members m
where m.user_id = t.user_id
  and t.organization_id is null;

alter table public.gateway_transactions
  alter column organization_id set not null;

alter table public.gateway_transactions
  add constraint gateway_transactions_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;

create index if not exists gateway_transactions_org_created_idx
  on public.gateway_transactions(organization_id, created_at desc);

create unique index if not exists gateway_transactions_org_idempotency_uidx
  on public.gateway_transactions(organization_id, idempotency_key)
  where idempotency_key is not null;

alter table public.gateway_payment_attempts
  add column if not exists organization_id uuid;

update public.gateway_payment_attempts a
set organization_id = t.organization_id
from public.gateway_transactions t
where t.id = a.transaction_id
  and a.organization_id is null;

update public.gateway_payment_attempts a
set organization_id = m.organization_id
from public.organization_members m
where m.user_id = a.user_id
  and a.organization_id is null;

alter table public.gateway_payment_attempts
  alter column organization_id set not null;

alter table public.gateway_payment_attempts
  add constraint gateway_payment_attempts_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;

create index if not exists gateway_payment_attempts_org_created_idx
  on public.gateway_payment_attempts(organization_id, created_at desc);

alter table public.gateway_transactions enable row level security;
alter table public.gateway_transactions force row level security;
alter table public.gateway_payment_attempts enable row level security;
alter table public.gateway_payment_attempts force row level security;

drop policy if exists gateway_transactions_org_read on public.gateway_transactions;
create policy gateway_transactions_org_read
on public.gateway_transactions for select to authenticated
using (private.is_org_member(organization_id));

drop policy if exists gateway_payment_attempts_org_read on public.gateway_payment_attempts;
create policy gateway_payment_attempts_org_read
on public.gateway_payment_attempts for select to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.gateway_transactions from anon, authenticated;
grant select on table public.gateway_transactions to authenticated;
revoke all on table public.gateway_payment_attempts from anon, authenticated;
grant select on table public.gateway_payment_attempts to authenticated;

create or replace function public.create_gateway_transaction(
  p_user_id uuid,
  p_organization_id uuid,
  p_funnel_id text,
  p_product_id text,
  p_amount numeric,
  p_currency text,
  p_customer jsonb,
  p_metadata jsonb,
  p_idempotency_key text
)
returns public.gateway_transactions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.gateway_transactions;
  v_existing public.gateway_transactions;
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_customer jsonb := coalesce(p_customer, '{}'::jsonb);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_user_id is null or p_organization_id is null then raise exception 'invalid_owner'; end if;
  if not exists (select 1 from public.organization_members m where m.user_id=p_user_id and m.organization_id=p_organization_id) then
    raise exception 'owner_not_in_organization';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'invalid_amount'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if v_key is null or length(v_key) > 255 then raise exception 'invalid_idempotency_key'; end if;
  if jsonb_typeof(v_customer) <> 'object' or jsonb_typeof(v_metadata) <> 'object' then raise exception 'invalid_payload'; end if;

  if p_funnel_id is not null and not exists (
    select 1 from public.funnels f where f.id=p_funnel_id and f.organization_id=p_organization_id and f.user_id=p_user_id
  ) then raise exception 'funnel_not_found'; end if;

  if p_product_id is not null and not exists (
    select 1 from public.products p where p.id=p_product_id and p.organization_id=p_organization_id and p.status='active' and p.deleted_at is null
  ) then raise exception 'product_not_found_or_inactive'; end if;

  select * into v_existing
  from public.gateway_transactions
  where organization_id=p_organization_id and idempotency_key=v_key
  order by created_at desc limit 1;
  if found then return v_existing; end if;

  insert into public.gateway_transactions(
    user_id, organization_id, funnel_id, product_id, amount, currency, status,
    customer, metadata, idempotency_key, attempt_count, routing_metadata, version
  ) values (
    p_user_id, p_organization_id, p_funnel_id, p_product_id, p_amount, v_currency, 'created',
    v_customer, v_metadata, v_key, 0, '{}'::jsonb, 1
  ) returning * into v_row;

  return v_row;
exception when unique_violation then
  select * into v_existing from public.gateway_transactions
  where organization_id=p_organization_id and idempotency_key=v_key
  order by created_at desc limit 1;
  if found then return v_existing; end if;
  raise;
end;
$$;

revoke all on function public.create_gateway_transaction(uuid,uuid,text,text,numeric,text,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_gateway_transaction(uuid,uuid,text,text,numeric,text,jsonb,jsonb,text) to service_role;

commit;