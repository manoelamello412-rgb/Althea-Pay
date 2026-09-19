create table if not exists public.gateway_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id text,
  product_id text,
  gateway_id uuid,
  gateway_name text,
  routing_rule_id uuid,
  idempotency_key text not null,
  attempt_order integer not null check (attempt_order > 0),
  status text not null check (status in ('pending','processing','approved','declined','error','unknown')),
  failure_class text check (failure_class in ('technical','timeout','unavailable','declined','fraud','pending','unknown')),
  external_transaction_id text,
  response_code integer,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create unique index if not exists idx_gateway_payment_attempts_idem
  on public.gateway_payment_attempts (user_id, idempotency_key);
create index if not exists idx_gateway_payment_attempts_sale
  on public.gateway_payment_attempts (user_id, sale_id, created_at desc);
create index if not exists idx_gateway_payment_attempts_gateway
  on public.gateway_payment_attempts (user_id, gateway_id, status, created_at desc);

create table if not exists public.gateway_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gateway_id uuid,
  gateway_name text,
  is_healthy boolean not null,
  latency_ms integer,
  consecutive_failures integer not null default 0,
  circuit_state text not null default 'closed' check (circuit_state in ('closed','open','half_open')),
  checked_at timestamptz not null default timezone('utc', now()),
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_gateway_health_snapshots_latest
  on public.gateway_health_snapshots (user_id, gateway_id, checked_at desc);

alter table public.gateway_payment_attempts enable row level security;
alter table public.gateway_health_snapshots enable row level security;

drop policy if exists gateway_payment_attempts_select on public.gateway_payment_attempts;
create policy gateway_payment_attempts_select on public.gateway_payment_attempts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists gateway_health_snapshots_select on public.gateway_health_snapshots;
create policy gateway_health_snapshots_select on public.gateway_health_snapshots
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.gateway_payment_attempts from authenticated;
revoke insert, update, delete on public.gateway_health_snapshots from authenticated;

create or replace function public.can_failover_payment(failure_class text)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select failure_class in ('technical','timeout','unavailable');
$$;

grant execute on function public.can_failover_payment(text) to authenticated;
