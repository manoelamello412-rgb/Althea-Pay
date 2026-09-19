create extension if not exists pgcrypto;

create table if not exists public.merchant_business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document_type varchar(10) not null default 'CNPJ' check (document_type in ('CNPJ','CPF')),
  document_number varchar(32),
  legal_name varchar(255),
  operation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.merchant_business_profiles enable row level security;

drop policy if exists merchant_business_profiles_select on public.merchant_business_profiles;
drop policy if exists merchant_business_profiles_insert on public.merchant_business_profiles;
drop policy if exists merchant_business_profiles_update on public.merchant_business_profiles;

create policy merchant_business_profiles_select on public.merchant_business_profiles for select to authenticated using (user_id = auth.uid());
create policy merchant_business_profiles_insert on public.merchant_business_profiles for insert to authenticated with check (user_id = auth.uid());
create policy merchant_business_profiles_update on public.merchant_business_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.upsert_gateway_credential(
  p_gateway_name text,
  p_api_key text,
  p_metadata jsonb default '{}'::jsonb,
  p_is_active boolean default true,
  p_priority_order integer default 1
)
returns public.user_gateway_credentials
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_row public.user_gateway_credentials;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if length(trim(coalesce(p_gateway_name, ''))) = 0 then
    raise exception 'gateway_name_required';
  end if;
  if length(coalesce(p_api_key, '')) < 8 then
    raise exception 'api_key_too_short';
  end if;
  if p_priority_order < 1 then
    raise exception 'priority_order_invalid';
  end if;
  v_key := current_setting('app.settings.gateway_encryption_key', true);
  if coalesce(v_key, '') = '' then
    raise exception 'gateway_encryption_key_not_configured';
  end if;
  insert into public.user_gateway_credentials(user_id, gateway_name, api_key_encrypted, secret_ref, metadata, is_active, priority_order)
  values (auth.uid(), lower(trim(p_gateway_name)), encode(pgp_sym_encrypt(p_api_key, v_key, 'cipher-algo=aes256'), 'base64'), null, coalesce(p_metadata, '{}'::jsonb), coalesce(p_is_active, true), p_priority_order)
  on conflict (user_id, gateway_name) do update set
    api_key_encrypted = excluded.api_key_encrypted,
    secret_ref = null,
    metadata = excluded.metadata,
    is_active = excluded.is_active,
    priority_order = excluded.priority_order,
    updated_at = timezone('utc', now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.upsert_gateway_credential(text, text, jsonb, boolean, integer) from public;
grant execute on function public.upsert_gateway_credential(text, text, jsonb, boolean, integer) to authenticated;

create or replace function public.get_gateway_routing_score(
  p_user_id uuid,
  p_gateway_id uuid,
  p_card_brand text
)
returns numeric
language sql
security definer
set search_path = public
as $$
  with recent as (
    select
      case when lower(coalesce(attempt->>'card_brand', '')) = lower(coalesce(p_card_brand, '')) then 1 else 0 end as brand_match,
      case when lower(coalesce(attempt->>'outcome', '')) = 'approved' then 1 else 0 end as approved
    from public.transaction_routing_logs l
    cross join lateral jsonb_array_elements(coalesce(l.gateways_attempted, '[]'::jsonb)) attempt
    where l.user_id = p_user_id
      and l.created_at >= timezone('utc', now()) - interval '10 minutes'
      and attempt->>'gateway_id' = p_gateway_id::text
  )
  select coalesce(round((100.0 * sum(approved * brand_match) / nullif(sum(brand_match), 0))::numeric, 2), 0)
  from recent;
$$;

revoke all on function public.get_gateway_routing_score(uuid, uuid, text) from public;
grant execute on function public.get_gateway_routing_score(uuid, uuid, text) to authenticated, service_role;

create or replace function public.touch_merchant_business_profile_updated_at()
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

drop trigger if exists trg_merchant_business_profile_updated_at on public.merchant_business_profiles;
create trigger trg_merchant_business_profile_updated_at before update on public.merchant_business_profiles for each row execute function public.touch_merchant_business_profile_updated_at();

create index if not exists idx_transaction_routing_logs_user_gateway_created on public.transaction_routing_logs(user_id, created_at desc, final_gateway);
