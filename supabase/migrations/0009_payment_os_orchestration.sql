-- ALTHEA PAYMENT OS
-- Provider-agnostic payment orchestration foundation.
-- Funnels are first-class payment surfaces. Gateways are replaceable providers.

create type public.payment_method as enum ('pix','credit_card','debit_card','boleto');
create type public.payment_flow_status as enum ('draft','published','archived');
create type public.payment_attempt_status as enum ('pending','authorized','paid','failed','unknown','cancelled','refunded');
create type public.routing_action as enum ('route','fallback','park');

create table public.payment_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  name text not null,
  description text,
  status public.payment_flow_status not null default 'draft',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, name)
);

create unique index payment_flows_one_published_per_funnel
  on public.payment_flows (funnel_id)
  where status = 'published';

create table public.payment_flow_versions (
  id uuid primary key default gen_random_uuid(),
  payment_flow_id uuid not null references public.payment_flows(id) on delete cascade,
  version integer not null,
  status public.payment_flow_status not null default 'draft',
  published_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (payment_flow_id, version)
);

create table public.payment_flow_steps (
  id uuid primary key default gen_random_uuid(),
  payment_flow_version_id uuid not null references public.payment_flow_versions(id) on delete cascade,
  gateway_connection_id uuid not null references public.gateway_connections(id) on delete restrict,
  step_order integer not null check (step_order > 0),
  method public.payment_method not null,
  action public.routing_action not null default 'route',
  conditions jsonb not null default '{}'::jsonb,
  retryable_statuses text[] not null default array[]::text[],
  max_attempts smallint not null default 1 check (max_attempts between 1 and 5),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (payment_flow_version_id, method, step_order)
);

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid not null references public.funnels(id) on delete restrict,
  payment_flow_id uuid references public.payment_flows(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  external_reference text,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'BRL',
  method public.payment_method not null,
  status public.payment_attempt_status not null default 'pending',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete cascade,
  gateway_connection_id uuid not null references public.gateway_connections(id) on delete restrict,
  flow_version_id uuid references public.payment_flow_versions(id) on delete set null,
  flow_step_id uuid references public.payment_flow_steps(id) on delete set null,
  attempt_number smallint not null check (attempt_number > 0),
  status public.payment_attempt_status not null default 'pending',
  external_payment_id text,
  external_status text,
  error_code text,
  error_message text,
  response_metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_intent_id, attempt_number)
);

create unique index payment_attempts_gateway_external_unique
  on public.payment_attempts (gateway_connection_id, external_payment_id)
  where external_payment_id is not null;

create table public.payment_idempotency_locks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  status text not null check (status in ('processing','completed','failed')),
  response jsonb,
  locked_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organization_id, idempotency_key)
);

create index payment_flows_org_idx on public.payment_flows(organization_id);
create index payment_flow_versions_flow_idx on public.payment_flow_versions(payment_flow_id, version desc);
create index payment_flow_steps_version_method_idx on public.payment_flow_steps(payment_flow_version_id, method, step_order);
create index payment_intents_org_created_idx on public.payment_intents(organization_id, created_at desc);
create index payment_intents_funnel_created_idx on public.payment_intents(funnel_id, created_at desc);
create index payment_attempts_intent_idx on public.payment_attempts(payment_intent_id, attempt_number);

alter table public.payment_flows enable row level security;
alter table public.payment_flow_versions enable row level security;
alter table public.payment_flow_steps enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_idempotency_locks enable row level security;

create policy payment_flows_member_select on public.payment_flows
  for select to authenticated using (public.is_org_member(organization_id));

create policy payment_flow_versions_member_select on public.payment_flow_versions
  for select to authenticated using (
    exists (
      select 1 from public.payment_flows f
      where f.id = payment_flow_id and public.is_org_member(f.organization_id)
    )
  );

create policy payment_flow_steps_member_select on public.payment_flow_steps
  for select to authenticated using (
    exists (
      select 1
      from public.payment_flow_versions v
      join public.payment_flows f on f.id = v.payment_flow_id
      where v.id = payment_flow_version_id and public.is_org_member(f.organization_id)
    )
  );

create policy payment_intents_member_select on public.payment_intents
  for select to authenticated using (public.is_org_member(organization_id));

create policy payment_attempts_member_select on public.payment_attempts
  for select to authenticated using (
    exists (
      select 1 from public.payment_intents i
      where i.id = payment_intent_id and public.is_org_member(i.organization_id)
    )
  );

create policy payment_idempotency_locks_member_select on public.payment_idempotency_locks
  for select to authenticated using (public.is_org_member(organization_id));

create or replace function public.current_payment_flow_version(target_funnel uuid, target_method public.payment_method)
returns table (
  flow_id uuid,
  version_id uuid,
  version integer,
  step_id uuid,
  gateway_connection_id uuid,
  step_order integer,
  action public.routing_action,
  conditions jsonb,
  retryable_statuses text[],
  max_attempts smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    v.id,
    v.version,
    s.id,
    s.gateway_connection_id,
    s.step_order,
    s.action,
    s.conditions,
    s.retryable_statuses,
    s.max_attempts
  from public.payment_flows f
  join public.payment_flow_versions v
    on v.payment_flow_id = f.id
   and v.status = 'published'
  join public.payment_flow_steps s
    on s.payment_flow_version_id = v.id
   and s.method = target_method
   and s.enabled = true
  where f.funnel_id = target_funnel
    and f.status = 'published'
  order by s.step_order asc;
$$;

comment on table public.payment_flows is 'First-class payment routing configuration owned by a funnel.';
comment on table public.payment_flow_steps is 'Deterministic provider routing steps. Providers remain replaceable gateway connections.';
comment on table public.payment_idempotency_locks is 'Persistent idempotency state used to prevent duplicate payment mutations.';
