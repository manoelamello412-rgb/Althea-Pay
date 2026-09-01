-- Compliance foundation only. No payment-card data belongs in these tables.
create table if not exists public.merchant_risk (
  user_id uuid primary key references auth.users(id) on delete cascade,
  risk_level text not null default 'unreviewed' check (risk_level in ('unreviewed','low','medium','high','blocked')),
  risk_score numeric,
  review_status text not null default 'pending' check (review_status in ('pending','in_review','approved','rejected')),
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.verification_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'unverified' check (status in ('unverified','pending','verified','rejected','expired')),
  provider text,
  external_reference text,
  verified_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  status text not null default 'recorded',
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.merchant_risk enable row level security;
alter table public.verification_status enable row level security;
alter table public.compliance_events enable row level security;

create policy merchant_risk_owner_read on public.merchant_risk for select to authenticated using (user_id = auth.uid());
create policy verification_status_owner_read on public.verification_status for select to authenticated using (user_id = auth.uid());
create policy compliance_events_owner_read on public.compliance_events for select to authenticated using (user_id = auth.uid());

create index if not exists compliance_events_user_time_idx on public.compliance_events(user_id, created_at desc);
create index if not exists compliance_events_external_idx on public.compliance_events(user_id, external_id) where external_id is not null;

comment on table public.merchant_risk is 'Merchant risk state. Do not store card data or identity documents here.';
comment on table public.verification_status is 'Verification state/reference only; provider owns identity evidence.';
comment on table public.compliance_events is 'Append-only compliance event metadata; sensitive evidence stays with the certified provider.';
