-- ALTHEA PAY 0010
-- IMPORTANT: the live canonical funnel/product IDs are TEXT and tenant ownership is user_id.
-- Keep these primitives aligned with the deployed schema; do not introduce UUID FKs here.

create table if not exists public.funnel_steps (
  id uuid primary key default gen_random_uuid(),
  funnel_id text not null references public.funnels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_key text not null,
  step_type text not null check (step_type in ('entry','landing','capture','sales_page','offer','checkout','payment','order_bump','upsell','downsell','thank_you','custom')),
  name text not null,
  position integer not null check (position >= 0),
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, step_key),
  unique (funnel_id, position)
);
create index if not exists funnel_steps_funnel_position_idx on public.funnel_steps(funnel_id, position);

create table if not exists public.funnel_step_links (
  id uuid primary key default gen_random_uuid(),
  funnel_id text not null references public.funnels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_step_id uuid not null references public.funnel_steps(id) on delete cascade,
  to_step_id uuid not null references public.funnel_steps(id) on delete cascade,
  condition jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  unique (from_step_id, to_step_id, priority),
  check (from_step_id <> to_step_id)
);
create index if not exists funnel_step_links_from_idx on public.funnel_step_links(from_step_id, priority);

create table if not exists public.funnel_offers (
  id uuid primary key default gen_random_uuid(),
  funnel_id text not null references public.funnels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete restrict,
  step_id uuid references public.funnel_steps(id) on delete set null,
  offer_type text not null default 'primary' check (offer_type in ('primary','order_bump','upsell','downsell','cross_sell')),
  name text not null,
  price numeric(18,2) not null check (price >= 0),
  currency text not null default 'BRL',
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists funnel_offers_funnel_idx on public.funnel_offers(funnel_id, created_at desc);

create table if not exists public.funnel_automation_rules (
  id uuid primary key default gen_random_uuid(),
  funnel_id text not null references public.funnels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('lead_created','checkout_started','checkout_abandoned','payment_pending','payment_approved','payment_failed','upsell_accepted','upsell_declined','custom_event')),
  action_type text not null check (action_type in ('crm_tag','send_email','send_whatsapp','webhook','advance_step','create_customer','custom')),
  conditions jsonb not null default '{}'::jsonb,
  action_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists funnel_automation_rules_funnel_idx on public.funnel_automation_rules(funnel_id, enabled);

alter table public.funnel_steps enable row level security;
alter table public.funnel_step_links enable row level security;
alter table public.funnel_offers enable row level security;
alter table public.funnel_automation_rules enable row level security;

create policy funnel_steps_owner_select on public.funnel_steps for select to authenticated using (user_id = auth.uid());
create policy funnel_steps_owner_insert on public.funnel_steps for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.funnels f where f.id = funnel_id and f.user_id = auth.uid()));
create policy funnel_steps_owner_update on public.funnel_steps for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy funnel_steps_owner_delete on public.funnel_steps for delete to authenticated using (user_id = auth.uid());

create policy funnel_step_links_owner_select on public.funnel_step_links for select to authenticated using (user_id = auth.uid());
create policy funnel_step_links_owner_insert on public.funnel_step_links for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.funnels f where f.id = funnel_id and f.user_id = auth.uid()));
create policy funnel_step_links_owner_update on public.funnel_step_links for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy funnel_step_links_owner_delete on public.funnel_step_links for delete to authenticated using (user_id = auth.uid());

create policy funnel_offers_owner_select on public.funnel_offers for select to authenticated using (user_id = auth.uid());
create policy funnel_offers_owner_insert on public.funnel_offers for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.funnels f where f.id = funnel_id and f.user_id = auth.uid()));
create policy funnel_offers_owner_update on public.funnel_offers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy funnel_offers_owner_delete on public.funnel_offers for delete to authenticated using (user_id = auth.uid());

create policy funnel_automation_rules_owner_select on public.funnel_automation_rules for select to authenticated using (user_id = auth.uid());
create policy funnel_automation_rules_owner_insert on public.funnel_automation_rules for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.funnels f where f.id = funnel_id and f.user_id = auth.uid()));
create policy funnel_automation_rules_owner_update on public.funnel_automation_rules for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy funnel_automation_rules_owner_delete on public.funnel_automation_rules for delete to authenticated using (user_id = auth.uid());

create or replace function public.seed_funnel_structure(target_funnel text)
returns setof public.funnel_steps
language plpgsql
security definer
set search_path = public
as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.funnels where id = target_funnel and deleted_at is null;
  if owner_id is null then raise exception 'FUNNEL_NOT_FOUND'; end if;
  if owner_id <> auth.uid() then raise exception 'FORBIDDEN'; end if;

  insert into public.funnel_steps (funnel_id, user_id, step_key, step_type, name, position, status) values
    (target_funnel, owner_id, 'entry', 'entry', 'Entrada', 0, 'active'),
    (target_funnel, owner_id, 'sales-page', 'sales_page', 'Página de vendas', 1, 'draft'),
    (target_funnel, owner_id, 'checkout', 'checkout', 'Checkout', 2, 'draft'),
    (target_funnel, owner_id, 'payment', 'payment', 'Pagamento', 3, 'draft'),
    (target_funnel, owner_id, 'thank-you', 'thank_you', 'Obrigado', 4, 'draft')
  on conflict (funnel_id, step_key) do nothing;

  insert into public.funnel_step_links (funnel_id, user_id, from_step_id, to_step_id, priority)
  select target_funnel, owner_id, a.id, b.id, 0
  from public.funnel_steps a
  join public.funnel_steps b on b.funnel_id = target_funnel and b.position = a.position + 1
  where a.funnel_id = target_funnel
  on conflict (from_step_id, to_step_id, priority) do nothing;

  return query select * from public.funnel_steps where funnel_id = target_funnel order by position;
end;
$$;

revoke all on function public.seed_funnel_structure(text) from public;
grant execute on function public.seed_funnel_structure(text) to authenticated;
