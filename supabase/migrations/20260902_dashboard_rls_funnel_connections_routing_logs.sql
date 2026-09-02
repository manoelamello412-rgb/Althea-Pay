create extension if not exists pgcrypto;

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

alter table public.funnel_connections enable row level security;
alter table public.transaction_routing_logs enable row level security;

grant select on public.funnel_connections to authenticated;
grant select on public.transaction_routing_logs to authenticated;

revoke all on public.transaction_routing_logs from anon;
revoke insert, update, delete on public.transaction_routing_logs from authenticated;

drop policy if exists funnel_connections_select_own on public.funnel_connections;
drop policy if exists funnel_connections_owner on public.funnel_connections;
create policy funnel_connections_select_own
  on public.funnel_connections
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists transaction_routing_logs_select_own on public.transaction_routing_logs;
drop policy if exists transaction_routing_logs_select on public.transaction_routing_logs;
create policy transaction_routing_logs_select_own
  on public.transaction_routing_logs
  for select
  to authenticated
  using (user_id = auth.uid());

comment on table public.transaction_routing_logs is 'Audit trail for Smart Routing attempts and final gateway route. Rows are readable only by their owning authenticated user.';
comment on table public.funnel_connections is 'Funnel connection state. Authenticated users can read only rows owned by auth.uid().';