create table if not exists public.gateway_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.gateway_transactions(id) on delete restrict,
  gateway_id text not null references public.gateways(id) on delete restrict,
  idempotency_key text not null,
  amount numeric not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('pending','approved','failed','reversed')),
  external_refund_id text,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);
create unique index if not exists gateway_refunds_user_idempotency_uq on public.gateway_refunds(user_id, idempotency_key);
create index if not exists gateway_refunds_transaction_idx on public.gateway_refunds(transaction_id, created_at desc);
create index if not exists gateway_refunds_user_status_idx on public.gateway_refunds(user_id, status, created_at desc);
alter table public.gateway_refunds enable row level security;
drop policy if exists gateway_refunds_owner_select on public.gateway_refunds;
create policy gateway_refunds_owner_select on public.gateway_refunds for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.gateway_refunds from anon;
grant select on table public.gateway_refunds to authenticated;
