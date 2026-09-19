create table if not exists public.checkout_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, funnel_id text, product_id text, status text not null default 'started', currency text not null default 'BRL', amount numeric(14,2) not null default 0, customer jsonb not null default '{}'::jsonb, attribution jsonb not null default '{}'::jsonb, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.checkout_items (id uuid primary key default gen_random_uuid(), user_id uuid not null, checkout_id uuid not null references public.checkout_sessions(id) on delete cascade, product_id text, name text not null, unit_amount numeric(14,2) not null default 0, quantity integer not null default 1, kind text not null default 'main', created_at timestamptz not null default now());
create table if not exists public.checkout_offers (id uuid primary key default gen_random_uuid(), user_id uuid not null, funnel_id text, product_id text, name text not null, kind text not null default 'order_bump', amount numeric(14,2) not null default 0, enabled boolean not null default true, rules jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.checkout_events (id uuid primary key default gen_random_uuid(), user_id uuid not null, checkout_id uuid references public.checkout_sessions(id) on delete cascade, event_type text not null, external_id text, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(user_id, external_id));
create table if not exists public.attribution_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, funnel_id text, session_key text not null, source text, medium text, campaign text, content text, term text, click_id text, landing_url text, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb, unique(user_id, session_key));
create index if not exists checkout_sessions_user_created_idx on public.checkout_sessions(user_id, created_at desc);
create index if not exists checkout_sessions_funnel_idx on public.checkout_sessions(user_id, funnel_id, created_at desc);
create index if not exists checkout_items_checkout_idx on public.checkout_items(user_id, checkout_id);
create index if not exists checkout_offers_funnel_idx on public.checkout_offers(user_id, funnel_id, enabled);
create index if not exists checkout_events_checkout_idx on public.checkout_events(user_id, checkout_id, created_at desc);
create index if not exists attribution_sessions_funnel_idx on public.attribution_sessions(user_id, funnel_id, last_seen_at desc);
alter table public.checkout_sessions enable row level security;
alter table public.checkout_items enable row level security;
alter table public.checkout_offers enable row level security;
alter table public.checkout_events enable row level security;
alter table public.attribution_sessions enable row level security;
do $$ begin
create policy checkout_sessions_owner on public.checkout_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
create policy checkout_items_owner on public.checkout_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
create policy checkout_offers_owner on public.checkout_offers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
create policy checkout_events_owner on public.checkout_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
create policy attribution_sessions_owner on public.attribution_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;