-- Colunas/tabelas extras para a migration da Fase 3.
alter table public.gateway_transactions add column amount numeric, add column currency text default 'BRL', add column customer jsonb default '{}',
  add column deleted_at timestamptz, add column product_id text, add column updated_at timestamptz default now(), add column completed_at timestamptz;
create table public.reconciliation_items(id uuid primary key default gen_random_uuid(), transaction_id uuid, provider_fee numeric);
create table public.clients(id text primary key, organization_id uuid, user_id uuid, data jsonb, created_at timestamptz default now());
create table public.outbound_webhooks(id uuid primary key default gen_random_uuid(), user_id uuid, organization_id uuid, name text, endpoint_url text,
  events text[] not null default '{}', status text default 'active', secret_ref text, secret_hash text, max_attempts int default 5,
  created_at timestamptz default now(), updated_at timestamptz default now());
