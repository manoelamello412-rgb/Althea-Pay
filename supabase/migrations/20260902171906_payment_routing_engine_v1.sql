create table if not exists public.gateway_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id text,
  product_id text,
  gateway_id uuid,
  gateway_name text not null,
  routing_rule_id uuid references public.gateway_routing_rules(id) on delete set null,
  idempotency_key text not null,
  attempt_order integer not null check (attempt_order > 0),
  status text not null default 'pending' check (status in ('pending','processing','approved','declined','error','unknown')),
  failure_class text check (failure_class is null or failure_class in ('technical','timeout','unavailable','declined','fraud','pending','unknown')),
  external_transaction_id text,
  response_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_gateway_payment_attempts_idempotency
  on public.gateway_payment_attempts(user_id, idempotency_key);
create index if not exists idx_gateway_payment_attempts_sale
  on public.gateway_payment_attempts(user_id, sale_id, created_at desc);
create index if not exists idx_gateway_payment_attempts_gateway_status
  on public.gateway_payment_attempts(gateway_id, status, created_at desc);

alter table public.gateway_payment_attempts enable row level security;
create policy gateway_payment_attempts_select_own on public.gateway_payment_attempts
  for select to authenticated using (user_id = (select auth.uid()));

create table if not exists public.gateway_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  gateway_id uuid,
  gateway_name text not null,
  is_healthy boolean not null,
  latency_ms integer,
  consecutive_failures integer not null default 0,
  circuit_state text not null default 'closed' check (circuit_state in ('closed','open','half_open')),
  checked_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_gateway_health_latest
  on public.gateway_health_snapshots(gateway_id, checked_at desc);

alter table public.gateway_health_snapshots enable row level security;
create policy gateway_health_snapshots_select_own on public.gateway_health_snapshots
  for select to authenticated using (user_id = (select auth.uid()));

create trigger trg_gateway_payment_attempts_updated_at
before update on public.gateway_payment_attempts
for each row execute function public.touch_premium_orchestration_updated_at();

create or replace function public.can_failover_payment(p_failure_class text)
returns boolean
language sql
immutable
security invoker
as $$
  select coalesce(p_failure_class in ('technical','timeout','unavailable'), false);
$$;

revoke all on function public.can_failover_payment(text) from public;
grant execute on function public.can_failover_payment(text) to postgres, service_role;