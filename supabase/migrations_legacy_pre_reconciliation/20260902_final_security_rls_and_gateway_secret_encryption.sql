create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_gateway_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gateway_name varchar(50) not null,
  api_key_encrypted text,
  secret_ref text,
  is_active boolean not null default true,
  priority_order integer not null default 1 check (priority_order > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_gateway_credentials_secret_source check (api_key_encrypted is not null or secret_ref is not null),
  constraint unique_user_gateway_credentials unique (user_id, gateway_name)
);

create index if not exists idx_user_gateway_credentials_routing on public.user_gateway_credentials (user_id, is_active, priority_order);

alter table public.user_gateway_credentials enable row level security;
grant select on public.user_gateway_credentials to authenticated;
drop policy if exists user_gateway_credentials_select on public.user_gateway_credentials;
create policy user_gateway_credentials_select on public.user_gateway_credentials for select to authenticated using ((select auth.uid()) = user_id);
revoke select (api_key_encrypted, secret_ref) on public.user_gateway_credentials from authenticated;

grant select on public.funnel_connections to authenticated;
grant select on public.sales to authenticated;
grant select on public.gateway_transactions to authenticated;

alter table public.funnel_connections enable row level security;
alter table public.sales enable row level security;
alter table public.gateway_transactions enable row level security;

drop policy if exists funnel_connections_select_own on public.funnel_connections;
create policy funnel_connections_select_own on public.funnel_connections for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists sales_select_own on public.sales;
create policy sales_select_own on public.sales for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists gateway_transactions_select_own on public.gateway_transactions;
create policy gateway_transactions_select_own on public.gateway_transactions for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.althea_gateway_encryption_key()
returns text language sql security definer
set search_path = pg_catalog, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'althea_gateway_encryption_key' order by created_at desc limit 1;
$$;
revoke all on function public.althea_gateway_encryption_key() from public, anon, authenticated;
grant execute on function public.althea_gateway_encryption_key() to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'althea_gateway_encryption_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'althea_gateway_encryption_key', 'ALTHEA PAY gateway API-key encryption key');
  end if;
end $$;

create or replace function public.encrypt_gateway_api_key(p_plaintext text)
returns text language sql security definer
set search_path = pg_catalog, public, extensions
as $$
  select case when p_plaintext is null or p_plaintext = '' then null else extensions.pgp_sym_encrypt(p_plaintext, public.althea_gateway_encryption_key(), 'cipher-algo=aes256,compress-algo=2') end;
$$;
create or replace function public.decrypt_gateway_api_key(p_ciphertext text)
returns text language sql security definer
set search_path = pg_catalog, public, extensions
as $$
  select case when p_ciphertext is null or p_ciphertext = '' then null else extensions.pgp_sym_decrypt(p_ciphertext::bytea, public.althea_gateway_encryption_key()) end;
$$;
revoke all on function public.encrypt_gateway_api_key(text) from public, anon, authenticated;
revoke all on function public.decrypt_gateway_api_key(text) from public, anon, authenticated;
grant execute on function public.encrypt_gateway_api_key(text) to service_role;
grant execute on function public.decrypt_gateway_api_key(text) to service_role;

update public.user_gateway_credentials
set api_key_encrypted = extensions.pgp_sym_encrypt(api_key_encrypted, public.althea_gateway_encryption_key(), 'cipher-algo=aes256,compress-algo=2')
where api_key_encrypted is not null and api_key_encrypted not like '-----BEGIN PGP MESSAGE-----%';

alter table public.user_gateway_credentials drop constraint if exists user_gateway_credentials_ciphertext_format;
alter table public.user_gateway_credentials add constraint user_gateway_credentials_ciphertext_format check (api_key_encrypted is null or api_key_encrypted like '-----BEGIN PGP MESSAGE-----%');

comment on column public.user_gateway_credentials.api_key_encrypted is 'PGP AES-256 ciphertext. Encryption key is held in Supabase Vault; plaintext is never exposed to authenticated browser clients.';
