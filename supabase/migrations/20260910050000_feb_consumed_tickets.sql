create table if not exists public.feb_consumed_tickets (
  jti text primary key,
  execution_id uuid not null,
  tenant_id uuid not null,
  user_id uuid not null,
  tool_key text not null,
  tool_version integer not null,
  gateway_id uuid not null,
  action text not null check (action in ('purchase','capture','refund','void')),
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  issuer text not null,
  audience text not null,
  kid text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

alter table public.feb_consumed_tickets enable row level security;

revoke all on public.feb_consumed_tickets from anon, authenticated;
grant select, insert on public.feb_consumed_tickets to service_role;

create index if not exists feb_consumed_tickets_execution_id_idx
  on public.feb_consumed_tickets (execution_id);

create index if not exists feb_consumed_tickets_tenant_id_idempotency_key_idx
  on public.feb_consumed_tickets (tenant_id, idempotency_key);

comment on table public.feb_consumed_tickets is
  'Permanent consume-once ledger for IARA Financial Execution Boundary JTI values. Rows are never deleted or updated as part of normal operation.';
