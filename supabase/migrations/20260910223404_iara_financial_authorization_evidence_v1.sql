begin;

create table if not exists public.iara_financial_confirmations (
  confirmation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id uuid not null,
  tool_key text not null,
  tool_version integer not null,
  gateway_id text not null,
  action text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  confirmed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  constraint iara_financial_confirmations_tool_version_check check (tool_version > 0),
  constraint iara_financial_confirmations_action_check check (action = any(array['purchase','capture','refund','void']::text[])),
  constraint iara_financial_confirmations_request_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

create index if not exists iara_financial_confirmations_expiry_idx on public.iara_financial_confirmations(expires_at) where consumed_at is null;
create index if not exists iara_financial_confirmations_lookup_idx on public.iara_financial_confirmations(user_id,tenant_id,request_fingerprint);

alter table public.iara_financial_confirmations enable row level security;
revoke all on public.iara_financial_confirmations from public,anon,authenticated;
grant all on public.iara_financial_confirmations to service_role;

commit;
