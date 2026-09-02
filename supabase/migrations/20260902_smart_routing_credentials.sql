-- ALTHEA PAY — Smart Routing / Multi-Gateway Credentials
-- Secrets are stored as ciphertext/reference only. Plain API keys must never be exposed to the browser.

create table if not exists public.user_gateway_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gateway_name varchar(50) not null,
  api_key_encrypted text,
  secret_ref text,
  is_active boolean not null default true,
  priority_order integer not null default 1 check (priority_order > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_gateway_credentials_secret_source check (api_key_encrypted is not null or secret_ref is not null),
  constraint unique_user_gateway_credentials unique (user_id, gateway_name)
);

create index if not exists idx_user_gateway_credentials_routing
  on public.user_gateway_credentials (user_id, is_active, priority_order);

create table if not exists public.transaction_routing_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id text,
  idempotency_key text,
  amount numeric(14,2) not null check (amount > 0),
  currency varchar(3) not null default 'BRL',
  gateways_attempted jsonb not null default '[]'::jsonb,
  final_gateway varchar(50),
  status varchar(20) not null check (status in ('approved','failed','pending')),
  failure_class varchar(30),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create index if not exists idx_transaction_routing_logs_user_created
  on public.transaction_routing_logs (user_id, created_at desc);

create index if not exists idx_transaction_routing_logs_sale
  on public.transaction_routing_logs (user_id, sale_id);

alter table public.user_gateway_credentials enable row level security;
alter table public.transaction_routing_logs enable row level security;

-- The authenticated client may manage gateway configuration metadata, but never receives secret material.
drop policy if exists user_gateway_credentials_select on public.user_gateway_credentials;
drop policy if exists user_gateway_credentials_insert on public.user_gateway_credentials;
drop policy if exists user_gateway_credentials_update on public.user_gateway_credentials;
drop policy if exists user_gateway_credentials_delete on public.user_gateway_credentials;

create policy user_gateway_credentials_select
  on public.user_gateway_credentials for select to authenticated
  using (user_id = auth.uid());

create policy user_gateway_credentials_insert
  on public.user_gateway_credentials for insert to authenticated
  with check (user_id = auth.uid());

create policy user_gateway_credentials_update
  on public.user_gateway_credentials for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_gateway_credentials_delete
  on public.user_gateway_credentials for delete to authenticated
  using (user_id = auth.uid());

-- Never allow a normal browser session to read ciphertext/reference fields.
revoke select (api_key_encrypted, secret_ref) on public.user_gateway_credentials from authenticated;
revoke insert (api_key_encrypted, secret_ref) on public.user_gateway_credentials from authenticated;
revoke update (api_key_encrypted, secret_ref) on public.user_gateway_credentials from authenticated;

create policy transaction_routing_logs_select
  on public.transaction_routing_logs for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.transaction_routing_logs from authenticated;

create or replace function public.touch_smart_routing_credentials_updated_at()
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

drop trigger if exists trg_user_gateway_credentials_updated_at on public.user_gateway_credentials;
create trigger trg_user_gateway_credentials_updated_at
before update on public.user_gateway_credentials
for each row execute function public.touch_smart_routing_credentials_updated_at();

comment on table public.user_gateway_credentials is 'Gateway credentials owned by the merchant. Secret material is ciphertext or a Vault reference and is never readable by the browser.';
comment on table public.transaction_routing_logs is 'Audit/observability trail for Smart Routing attempts and final route.';
