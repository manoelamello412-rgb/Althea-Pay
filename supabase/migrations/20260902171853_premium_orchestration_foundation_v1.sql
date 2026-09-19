create table if not exists public.gateway_routing_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  priority_order integer not null check (priority_order > 0),
  gateway_id uuid,
  gateway_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gateway_routing_rules_gateway_ref check (gateway_id is not null or gateway_name is not null)
);

create index if not exists idx_gateway_routing_rules_user_product_priority
  on public.gateway_routing_rules(user_id, product_id, priority_order)
  where is_active = true;

create unique index if not exists uq_gateway_routing_rules_user_product_priority
  on public.gateway_routing_rules(user_id, product_id, priority_order)
  where is_active = true;

alter table public.gateway_routing_rules enable row level security;

create policy gateway_routing_rules_select_own on public.gateway_routing_rules
  for select to authenticated using (user_id = (select auth.uid()));
create policy gateway_routing_rules_insert_own on public.gateway_routing_rules
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy gateway_routing_rules_update_own on public.gateway_routing_rules
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy gateway_routing_rules_delete_own on public.gateway_routing_rules
  for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.affiliate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  status text not null default 'active' check (status in ('active','inactive','blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_affiliate_profiles_user on public.affiliate_profiles(user_id);

alter table public.affiliate_profiles enable row level security;
create policy affiliate_profiles_select_own on public.affiliate_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy affiliate_profiles_insert_own on public.affiliate_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy affiliate_profiles_update_own on public.affiliate_profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy affiliate_profiles_delete_own on public.affiliate_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sale_id text not null,
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete restrict,
  product_id text,
  commission_rate numeric(7,4) not null check (commission_rate >= 0 and commission_rate <= 100),
  amount_distributed numeric(18,2) not null check (amount_distributed >= 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','refunded','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_affiliate_commissions_user_sale on public.affiliate_commissions(user_id, sale_id);
create index if not exists idx_affiliate_commissions_affiliate_status on public.affiliate_commissions(affiliate_id, status);

alter table public.affiliate_commissions enable row level security;
create policy affiliate_commissions_select_own on public.affiliate_commissions
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.touch_premium_orchestration_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_premium_orchestration_updated_at() from public;
grant execute on function public.touch_premium_orchestration_updated_at() to postgres, service_role;

create trigger trg_gateway_routing_rules_updated_at
before update on public.gateway_routing_rules
for each row execute function public.touch_premium_orchestration_updated_at();

create trigger trg_affiliate_profiles_updated_at
before update on public.affiliate_profiles
for each row execute function public.touch_premium_orchestration_updated_at();

create trigger trg_affiliate_commissions_updated_at
before update on public.affiliate_commissions
for each row execute function public.touch_premium_orchestration_updated_at();