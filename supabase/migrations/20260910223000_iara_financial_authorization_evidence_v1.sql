create table if not exists public.iara_financial_confirmations (
  confirmation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id uuid not null,
  tool_key text not null,
  tool_version integer not null check (tool_version > 0),
  gateway_id uuid not null,
  action text not null check (action in ('purchase','capture','refund','void')),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists iara_financial_confirmations_lookup_idx
  on public.iara_financial_confirmations(user_id, tenant_id, request_fingerprint);

create index if not exists iara_financial_confirmations_expiry_idx
  on public.iara_financial_confirmations(expires_at)
  where consumed_at is null;

alter table public.iara_financial_confirmations enable row level security;
revoke all on table public.iara_financial_confirmations from anon, authenticated, public;
grant all on table public.iara_financial_confirmations to service_role;
