create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id text,
  product_id text,
  funnel_id text,
  gateway_id text,
  transaction_id uuid,
  provider_subscription_id text,
  status text not null default 'active' check (status in ('trialing','active','past_due','paused','canceled','expired')),
  billing_interval text not null default 'month' check (billing_interval in ('day','week','month','year')),
  interval_count integer not null default 1 check (interval_count > 0),
  amount numeric not null default 0 check (amount >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_customer_tenant_fk foreign key (user_id, customer_id) references public.clients(user_id, id),
  constraint subscriptions_product_fk foreign key (product_id) references public.products(id),
  constraint subscriptions_funnel_fk foreign key (funnel_id) references public.funnels(id),
  constraint subscriptions_gateway_fk foreign key (gateway_id) references public.gateways(id),
  constraint subscriptions_transaction_fk foreign key (transaction_id) references public.gateway_transactions(id)
);

create unique index if not exists subscriptions_provider_identity_uidx on public.subscriptions(user_id, provider_subscription_id) where provider_subscription_id is not null;
create index if not exists subscriptions_user_status_idx on public.subscriptions(user_id, status);
create index if not exists subscriptions_user_period_idx on public.subscriptions(user_id, current_period_end);
create index if not exists subscriptions_user_created_idx on public.subscriptions(user_id, created_at);

alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists subscriptions_insert_own on public.subscriptions;
create policy subscriptions_insert_own on public.subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists subscriptions_update_own on public.subscriptions;
create policy subscriptions_update_own on public.subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  event_type text not null check (event_type in ('created','trial_started','activated','renewed','past_due','paused','resumed','canceled','expired','payment_failed','payment_recovered')),
  from_status text,
  to_status text,
  amount numeric check (amount is null or amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists subscription_events_provider_uidx on public.subscription_events(user_id, provider_event_id) where provider_event_id is not null;
create index if not exists subscription_events_subscription_time_idx on public.subscription_events(subscription_id, occurred_at desc);
create index if not exists subscription_events_user_time_idx on public.subscription_events(user_id, occurred_at desc);
alter table public.subscription_events enable row level security;
drop policy if exists subscription_events_select_own on public.subscription_events;
create policy subscription_events_select_own on public.subscription_events for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists subscription_events_insert_own on public.subscription_events;
create policy subscription_events_insert_own on public.subscription_events for insert to authenticated with check (user_id = (select auth.uid()));
