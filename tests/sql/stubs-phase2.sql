-- Colunas/tabelas extras que a migration da Fase 2 usa (aplicado depois das migrations da Fase 0/1).
alter table public.checkout_sessions
  add column status text default 'started', add column abandoned_at timestamptz, add column funnel_id text, add column product_id text,
  add column customer jsonb default '{}', add column attribution jsonb default '{}', add column metadata jsonb default '{}',
  add column amount numeric default 97, add column currency text default 'BRL', add column created_at timestamptz default now(),
  add column updated_at timestamptz default now(), add column recovery_count int not null default 0, add column recovery_status text,
  add column recovery_next_at timestamptz;
alter table public.recovery_events
  add column id uuid primary key default gen_random_uuid(), add column attempt_count int not null default 0, add column next_attempt_at timestamptz,
  add column processed_at timestamptz, add column updated_at timestamptz default now(), add column created_at timestamptz default now(),
  add column last_error text, add column channel text, add column conversation_id uuid, add column outbox_id uuid;
alter table public.gateway_transactions add column external_id text, add column failure_code text, add column error_message text, add column gateway_id text;
alter table public.funnels add column url text;
create table public.profiles(id uuid primary key, default_organization_id uuid);
create table public.products(id text primary key, name text, organization_id uuid);
create table public.gateways(id text primary key, display_name text, provider text, organization_id uuid);
create table storage.objects(bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function private.is_org_member(uuid) returns boolean language sql as $$ select true $$;
