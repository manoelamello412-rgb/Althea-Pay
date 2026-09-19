-- ALTHEA CORE
-- Production-oriented foundation. Apply through Supabase migrations.

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner','admin','manager','operator','supervisor','viewer');
create type public.funnel_status as enum ('draft','connected','paused','disconnected','error');
create type public.connection_status as enum ('pending','connected','disconnected','error');
create type public.lead_status as enum ('new','engaged','qualified','converted','lost','archived');
create type public.sale_status as enum ('pending','approved','failed','cancelled','refunded','chargeback');
create type public.chat_status as enum ('open','waiting','assigned','closed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.funnels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  external_url text,
  status public.funnel_status not null default 'draft',
  connection_status public.connection_status not null default 'pending',
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  external_reference text,
  currency text not null default 'BRL',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.funnel_products (
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (funnel_id, product_id)
);

create table public.gateway_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text not null,
  status public.connection_status not null default 'pending',
  capabilities jsonb not null default '{}'::jsonb,
  external_account_reference text,
  secret_ref text,
  public_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.funnel_gateway_connections (
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  gateway_connection_id uuid not null references public.gateway_connections(id) on delete restrict,
  is_active boolean not null default false,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (funnel_id, gateway_connection_id)
);

create unique index one_active_gateway_per_funnel
  on public.funnel_gateway_connections (funnel_id)
  where is_active = true;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_reference text,
  name text,
  email text,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid references public.funnels(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  status public.lead_status not null default 'new',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid references public.funnels(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  gateway_connection_id uuid references public.gateway_connections(id) on delete set null,
  external_payment_id text,
  external_order_id text,
  amount numeric(18,2) not null default 0,
  currency text not null default 'BRL',
  status public.sale_status not null default 'pending',
  source_event_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sales_external_payment_unique
  on public.sales (gateway_connection_id, external_payment_id)
  where external_payment_id is not null;

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  funnel_id uuid references public.funnels(id) on delete set null,
  gateway_connection_id uuid references public.gateway_connections(id) on delete set null,
  provider text,
  event_type text not null,
  external_event_id text,
  signature_valid boolean,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index integration_events_provider_external_unique
  on public.integration_events (provider, external_event_id)
  where external_event_id is not null;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid references public.funnels(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  visitor_reference text,
  status public.chat_status not null default 'open',
  assigned_user_id uuid references auth.users(id) on delete set null,
  priority smallint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_type text not null check (sender_type in ('visitor','operator','system')),
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index funnels_org_idx on public.funnels(organization_id);
create index products_org_idx on public.products(organization_id);
create index gateways_org_idx on public.gateway_connections(organization_id);
create index customers_org_idx on public.customers(organization_id);
create index leads_org_idx on public.leads(organization_id);
create index sales_org_created_idx on public.sales(organization_id, created_at desc);
create index events_org_created_idx on public.integration_events(organization_id, created_at desc);
create index chats_org_last_message_idx on public.chat_conversations(organization_id, last_message_at desc);
create index messages_conversation_created_idx on public.chat_messages(conversation_id, created_at);
create index audit_org_created_idx on public.audit_logs(organization_id, created_at desc);

-- Helper: membership check used by RLS policies.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
  );
$$;

-- RLS is enabled from the first migration so exposed tables do not accidentally become public.
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.funnels enable row level security;
alter table public.products enable row level security;
alter table public.funnel_products enable row level security;
alter table public.gateway_connections enable row level security;
alter table public.funnel_gateway_connections enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.sales enable row level security;
alter table public.integration_events enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.audit_logs enable row level security;

-- Initial member-scoped read policies. Write policies will be refined by role/capability in the next security migration.
create policy org_member_select on public.organizations for select to authenticated using (public.is_org_member(id));
create policy profile_self_select on public.profiles for select to authenticated using (id = auth.uid());
create policy member_self_select on public.organization_members for select to authenticated using (user_id = auth.uid() or public.is_org_member(organization_id));

create policy funnels_member_select on public.funnels for select to authenticated using (public.is_org_member(organization_id));
create policy products_member_select on public.products for select to authenticated using (public.is_org_member(organization_id));
create policy funnel_products_member_select on public.funnel_products for select to authenticated using (exists (select 1 from public.funnels f where f.id = funnel_id and public.is_org_member(f.organization_id)));
create policy gateways_member_select on public.gateway_connections for select to authenticated using (public.is_org_member(organization_id));
create policy funnel_gateways_member_select on public.funnel_gateway_connections for select to authenticated using (exists (select 1 from public.funnels f where f.id = funnel_id and public.is_org_member(f.organization_id)));
create policy customers_member_select on public.customers for select to authenticated using (public.is_org_member(organization_id));
create policy leads_member_select on public.leads for select to authenticated using (public.is_org_member(organization_id));
create policy sales_member_select on public.sales for select to authenticated using (public.is_org_member(organization_id));
create policy events_member_select on public.integration_events for select to authenticated using (organization_id is not null and public.is_org_member(organization_id));
create policy chats_member_select on public.chat_conversations for select to authenticated using (public.is_org_member(organization_id));
create policy messages_member_select on public.chat_messages for select to authenticated using (exists (select 1 from public.chat_conversations c where c.id = conversation_id and public.is_org_member(c.organization_id)));
create policy audit_member_select on public.audit_logs for select to authenticated using (organization_id is not null and public.is_org_member(organization_id));
