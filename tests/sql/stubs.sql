-- Stubs mínimos do schema Supabase/Althea para validar as migrations da Fase 0/1.
create extension if not exists pgcrypto;
create schema if not exists extensions;
create schema private; create schema auth; create schema vault; create schema storage;
create role anon; create role authenticated; create role service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create table storage.buckets(id text primary key, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets values ('chat-attachments', 4194304, array['image/png']);
create table vault.decrypted_secrets(id uuid primary key default gen_random_uuid(), name text, decrypted_secret text);
create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.decrypted_secrets(name, decrypted_secret) values (n, s) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.decrypted_secrets set decrypted_secret = s where id = i $$;
create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select public.gen_random_bytes($1) $$;

create table public.organizations(id uuid primary key default gen_random_uuid());
create type public.lead_checkout_status as enum ('no_checkout','parado_no_caixa');
create table public.funnels(id text primary key, nome text, organization_id uuid, deleted_at timestamptz);
create table public.audit_logs(id bigserial, user_id uuid, actor_id uuid, organization_id uuid, action text, resource_type text, resource_id text, metadata jsonb);
create table public.crm_channel_accounts(id uuid primary key default gen_random_uuid(), user_id uuid, organization_id uuid, channel text, provider text,
  display_name text, status text, external_account_id text, credentials_ref text, metadata jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
create unique index crm_channel_accounts_one_whatsapp_per_org on public.crm_channel_accounts(organization_id) where channel = 'whatsapp';
create table public.crm_conversations(id uuid primary key default gen_random_uuid(), user_id uuid, organization_id uuid, status text default 'open', priority text default 'normal',
  primary_channel text default 'funnel_chat', channel_account_id text, funnel_id text, product_id text, transaction_id text, buyer_name text, buyer_email text,
  customer_whatsapp text, customer_id uuid, assigned_to uuid, metadata jsonb default '{}', public_token text, last_message_at timestamptz, last_message_direction text,
  unread_count int default 0, checkout_status public.lead_checkout_status default 'no_checkout', last_activity_at timestamptz default now(), gateway_error_log jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.crm_messages(id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  user_id uuid, organization_id uuid, direction text, channel text, body text, metadata jsonb default '{}', client_message_id text, provider text,
  external_message_id text, channel_account_id text, sender_id uuid, created_at timestamptz default now());
create unique index on public.crm_messages(user_id, client_message_id) where client_message_id is not null;
-- touch: imita o trigger real (incrementa não lidas)
create function public.touch() returns trigger language plpgsql as $$ begin
  update public.crm_conversations set last_message_at = new.created_at, last_message_direction = new.direction,
    unread_count = unread_count + case when new.direction = 'inbound' then 1 else 0 end where id = new.conversation_id; return null; end $$;
create trigger crm_messages_touch_conversation after insert on public.crm_messages for each row execute function public.touch();
create table public.crm_channel_message_outbox(id uuid primary key default gen_random_uuid(), user_id uuid, conversation_id uuid references public.crm_conversations(id) on delete set null,
  channel_account_id uuid, channel text, external_message_id text, idempotency_key text, direction text, body text, status text, max_attempts int,
  next_attempt_at timestamptz, metadata jsonb, last_error text, updated_at timestamptz default now(), unique(user_id, idempotency_key));
create table public.gateway_transactions(id uuid primary key default gen_random_uuid(), user_id uuid, organization_id uuid, funnel_id text, status text,
  metadata jsonb default '{}', created_at timestamptz default now());
create table public.checkout_sessions(id uuid primary key default gen_random_uuid(), user_id uuid, organization_id uuid, completed_at timestamptz);
create table public.recovery_events(user_id uuid, organization_id uuid, checkout_id uuid, event_type text, status text, payload jsonb, unique(checkout_id, event_type));
create table public.merchant_business_profiles(user_id uuid primary key, document_type text, document_number text, legal_name text, operation_metadata jsonb, updated_at timestamptz);
create table private.funnel_event_rate_limit_buckets(bucket_key text primary key, updated_at timestamptz);
create function public.cleanup_althea_api_rate_limits() returns void language sql as $$ select $$;
create function public.check_checkout_inactivity() returns int language sql as $$ select 0 $$;

create function private.current_organization_id() returns uuid language sql as $$ select nullif(current_setting('test.org', true), '')::uuid $$;
create function private.has_org_capability(uuid, text) returns boolean language sql as $$ select coalesce(nullif(current_setting('test.cap', true), ''), 'on') = 'on' $$;
create function private.has_org_role(uuid, text[]) returns boolean language sql as $$ select coalesce(nullif(current_setting('test.role_name', true), ''), 'owner') = any($2) $$;
create function private.org_operational_history_hours(uuid) returns int language sql as $$ select 720 $$;
create function private.redact_crm_metadata(jsonb, boolean, boolean) returns jsonb language sql as $$ select $1 $$;
create function private.crm_config_context(text, out organization_id uuid, out owner_id uuid) language sql as $$
  select private.current_organization_id(), nullif(current_setting('test.uid', true), '')::uuid $$;
create function private.crm_whatsapp_secret(p uuid) returns jsonb language sql as $$
  select coalesce((select decrypted_secret::jsonb from vault.decrypted_secrets where id = p), '{}'::jsonb) $$;
