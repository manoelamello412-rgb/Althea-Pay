-- Operational reliability foundation. No payment-card data belongs here.
create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gateway_id text references public.gateways(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  source_type text not null default 'gateway_report',
  source_reference text,
  matched_count integer not null default 0,
  mismatch_count integer not null default 0,
  gross_expected numeric not null default 0,
  gross_reported numeric not null default 0,
  fees_expected numeric not null default 0,
  fees_reported numeric not null default 0,
  net_expected numeric not null default 0,
  net_reported numeric not null default 0,
  discrepancy_amount numeric not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  transaction_id uuid references public.gateway_transactions(id) on delete set null,
  external_transaction_id text,
  status text not null default 'unmatched' check (status in ('matched','amount_mismatch','missing_internal','missing_gateway','duplicate','unmatched')),
  expected_amount numeric,
  reported_amount numeric,
  discrepancy_amount numeric,
  mismatch_reason text,
  gateway_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_dead_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.integration_events(id) on delete set null,
  event_type text,
  reason text not null,
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now()
);

alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.event_dead_letters enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reconciliation_runs' and policyname='reconciliation_runs_owner_read') then
    create policy reconciliation_runs_owner_read on public.reconciliation_runs for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reconciliation_items' and policyname='reconciliation_items_owner_read') then
    create policy reconciliation_items_owner_read on public.reconciliation_items for select to authenticated using (user_id=(select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='event_dead_letters' and policyname='event_dead_letters_owner_read') then
    create policy event_dead_letters_owner_read on public.event_dead_letters for select to authenticated using (user_id=(select auth.uid()));
  end if;
end $$;

create index if not exists reconciliation_runs_user_period_idx on public.reconciliation_runs(user_id, period_end desc);
create index if not exists reconciliation_runs_gateway_status_idx on public.reconciliation_runs(gateway_id, status, created_at desc);
create index if not exists reconciliation_items_run_status_idx on public.reconciliation_items(run_id, status, created_at desc);
create index if not exists reconciliation_items_transaction_idx on public.reconciliation_items(transaction_id) where transaction_id is not null;
create index if not exists event_dead_letters_user_status_idx on public.event_dead_letters(user_id, resolved_at, created_at desc);
create index if not exists event_dead_letters_event_idx on public.event_dead_letters(event_id) where event_id is not null;
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc) where actor_id is not null;
create index if not exists checkout_items_checkout_id_idx on public.checkout_items(checkout_id);
create index if not exists disputes_transaction_id_idx on public.disputes(transaction_id) where transaction_id is not null;
create index if not exists gateway_operation_logs_gateway_id_idx on public.gateway_operation_logs(gateway_id, created_at desc) where gateway_id is not null;
create index if not exists gateway_routes_gateway_id_idx on public.gateway_routes(gateway_id) where gateway_id is not null;
create index if not exists gateway_transactions_gateway_id_idx on public.gateway_transactions(gateway_id, created_at desc) where gateway_id is not null;
create index if not exists gateway_transactions_product_id_idx on public.gateway_transactions(product_id, created_at desc) where product_id is not null;
create index if not exists organization_members_user_id_idx on public.organization_members(user_id);
create index if not exists team_funnel_access_funnel_id_idx on public.team_funnel_access(funnel_id);
