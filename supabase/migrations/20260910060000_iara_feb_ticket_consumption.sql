create table if not exists public.iara_feb_consumed_tickets (
  jti text primary key,
  execution_id uuid not null,
  tenant_id uuid not null references auth.users(id),
  kid text not null,
  issued_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  state text not null default 'CONSUMED' check (state in ('CONSUMED','UNKNOWN_EXTERNAL_EFFECT','RECOVERY_PENDING','RECONCILED'))
);

create index if not exists idx_iara_feb_consumed_tickets_tenant_execution
  on public.iara_feb_consumed_tickets (tenant_id, execution_id);

revoke all on table public.iara_feb_consumed_tickets from public, anon, authenticated;
grant select, insert, update on table public.iara_feb_consumed_tickets to service_role;

alter table public.iara_feb_consumed_tickets enable row level security;

comment on table public.iara_feb_consumed_tickets is
  'One-time FEB authorization evidence. JTI uniqueness is the anti-replay barrier; financial idempotency remains separate.';
