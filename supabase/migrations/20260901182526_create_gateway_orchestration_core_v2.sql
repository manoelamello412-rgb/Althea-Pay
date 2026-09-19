create table if not exists public.gateway_routes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 funnel_id text references public.funnels(id) on delete cascade,
 product_id text references public.products(id) on delete set null,
 gateway_id text references public.gateways(id) on delete set null,
 priority integer not null default 100,
 enabled boolean not null default true,
 fallback_enabled boolean not null default true,
 conditions jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists gateway_routes_user_idx on public.gateway_routes(user_id);
create index if not exists gateway_routes_funnel_idx on public.gateway_routes(funnel_id,priority);
create index if not exists gateway_routes_product_idx on public.gateway_routes(product_id,priority);
alter table public.gateway_routes enable row level security;
drop policy if exists gateway_routes_owner on public.gateway_routes;
create policy gateway_routes_owner on public.gateway_routes for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.gateway_transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 funnel_id text references public.funnels(id) on delete set null,
 product_id text references public.products(id) on delete set null,
 gateway_id text references public.gateways(id) on delete set null,
 external_id text,
 idempotency_key text,
 amount numeric(14,2) not null default 0,
 currency text not null default 'BRL',
 status text not null default 'created' check(status in ('created','pending','approved','failed','refunded','chargeback')),
 customer jsonb not null default '{}'::jsonb,
 metadata jsonb not null default '{}'::jsonb,
 error_message text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
create index if not exists gateway_transactions_user_created_idx on public.gateway_transactions(user_id,created_at desc);
create index if not exists gateway_transactions_funnel_idx on public.gateway_transactions(funnel_id,created_at desc);
create index if not exists gateway_transactions_status_idx on public.gateway_transactions(status,created_at desc);
alter table public.gateway_transactions enable row level security;
drop policy if exists gateway_transactions_owner on public.gateway_transactions;
create policy gateway_transactions_owner on public.gateway_transactions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.gateway_operation_logs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 transaction_id uuid references public.gateway_transactions(id) on delete cascade,
 gateway_id text references public.gateways(id) on delete set null,
 operation text not null,
 status text not null,
 attempt integer not null default 1,
 request_meta jsonb not null default '{}'::jsonb,
 response_meta jsonb not null default '{}'::jsonb,
 error_message text,
 created_at timestamptz not null default now()
);
create index if not exists gateway_operation_logs_tx_idx on public.gateway_operation_logs(transaction_id,created_at desc);
create index if not exists gateway_operation_logs_user_idx on public.gateway_operation_logs(user_id,created_at desc);
alter table public.gateway_operation_logs enable row level security;
drop policy if exists gateway_operation_logs_owner on public.gateway_operation_logs;
create policy gateway_operation_logs_owner on public.gateway_operation_logs for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create or replace function public.set_updated_at_gateway_core() returns trigger language plpgsql security definer set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists gateway_routes_updated_at on public.gateway_routes;
create trigger gateway_routes_updated_at before update on public.gateway_routes for each row execute function public.set_updated_at_gateway_core();
drop trigger if exists gateway_transactions_updated_at on public.gateway_transactions;
create trigger gateway_transactions_updated_at before update on public.gateway_transactions for each row execute function public.set_updated_at_gateway_core();
revoke execute on function public.set_updated_at_gateway_core() from public, anon, authenticated;
