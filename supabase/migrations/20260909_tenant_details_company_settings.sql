-- ALTHEA PAY — canonical tenant/company identity surface
-- The current account model is user-scoped. tenant_details is therefore keyed
-- by auth.users.id until a dedicated multi-member tenant relation exists.

create table if not exists public.tenant_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  legal_name varchar(255) not null default '',
  trade_name varchar(255) not null default '',
  document_id varchar(32),
  state_registration varchar(64),
  billing_email varchar(320),
  financial_metrics jsonb not null default jsonb_build_object(
    'monthly_billing_cents', 0,
    'tax_withheld_cents', 0,
    'current_tier', 'Standard'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.tenant_details enable row level security;

drop policy if exists tenant_details_select on public.tenant_details;
drop policy if exists tenant_details_insert on public.tenant_details;
drop policy if exists tenant_details_update on public.tenant_details;

create policy tenant_details_select
  on public.tenant_details for select to authenticated
  using (user_id = auth.uid());

create policy tenant_details_insert
  on public.tenant_details for insert to authenticated
  with check (user_id = auth.uid());

create policy tenant_details_update
  on public.tenant_details for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_tenant_details_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_tenant_details_updated_at on public.tenant_details;
create trigger trg_tenant_details_updated_at
before update on public.tenant_details
for each row execute function public.touch_tenant_details_updated_at();

-- CNPJ/CPF and state registration become immutable once initially populated.
create or replace function public.enforce_tenant_fiscal_immutability()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if nullif(trim(coalesce(old.document_id, '')), '') is not null
     and trim(coalesce(new.document_id, '')) <> trim(coalesce(old.document_id, '')) then
    raise exception 'tenant_document_immutable';
  end if;

  if nullif(trim(coalesce(old.state_registration, '')), '') is not null
     and trim(coalesce(new.state_registration, '')) <> trim(coalesce(old.state_registration, '')) then
    raise exception 'tenant_state_registration_immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tenant_details_fiscal_immutability on public.tenant_details;
create trigger trg_tenant_details_fiscal_immutability
before update on public.tenant_details
for each row execute function public.enforce_tenant_fiscal_immutability();

-- Atomic application-level mutation. Existing rows are locked before update.
-- This is intentionally SECURITY INVOKER so RLS remains authoritative.
create or replace function public.upsert_tenant_details(
  p_legal_name text,
  p_trade_name text,
  p_billing_email text,
  p_document_id text default null,
  p_state_registration text default null
)
returns public.tenant_details
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.tenant_details;
  v_document text := nullif(trim(coalesce(p_document_id, '')), '');
  v_ie text := nullif(trim(coalesce(p_state_registration, '')), '');
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;
  if nullif(trim(coalesce(p_legal_name, '')), '') is null then
    raise exception 'legal_name_required';
  end if;
  if nullif(trim(coalesce(p_billing_email, '')), '') is null then
    raise exception 'billing_email_required';
  end if;

  select * into v_row
  from public.tenant_details
  where user_id = v_user_id
  for update;

  if v_row.id is null then
    insert into public.tenant_details (
      user_id, legal_name, trade_name, billing_email, document_id, state_registration
    ) values (
      v_user_id,
      trim(p_legal_name),
      trim(coalesce(p_trade_name, '')),
      trim(p_billing_email),
      v_document,
      v_ie
    )
    returning * into v_row;
  else
    update public.tenant_details
    set legal_name = trim(p_legal_name),
        trade_name = trim(coalesce(p_trade_name, '')),
        billing_email = trim(p_billing_email),
        document_id = case
          when nullif(trim(coalesce(v_row.document_id, '')), '') is null then v_document
          else v_row.document_id
        end,
        state_registration = case
          when nullif(trim(coalesce(v_row.state_registration, '')), '') is null then v_ie
          else v_row.state_registration
        end
    where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_tenant_details(text, text, text, text, text) from public;
grant execute on function public.upsert_tenant_details(text, text, text, text, text) to authenticated;

create index if not exists tenant_details_updated_at_idx
  on public.tenant_details(updated_at desc);
