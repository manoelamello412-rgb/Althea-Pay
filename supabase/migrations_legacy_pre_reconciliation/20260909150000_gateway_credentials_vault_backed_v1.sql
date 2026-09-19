-- ALTHEA PAY — Gateway credentials Vault-backed hardening
--
-- Security model:
--   * Browser may submit a credential only through the authenticated RPC.
--   * Plaintext gateway credentials are stored in Supabase Vault, never in a public table.
--   * public.user_gateway_credentials keeps only operational metadata + vault reference.
--   * Legacy api_key_encrypted rows are intentionally preserved for backward compatibility;
--     they are not exposed to authenticated clients and are not used for new writes.
--   * Plaintext resolution is restricted to service_role for server-side orchestration.

create extension if not exists pgcrypto with schema extensions;

-- Stable Vault key used only for the legacy ciphertext compatibility path.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'althea_gateway_encryption_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'althea_gateway_encryption_key',
      'ALTHEA PAY legacy gateway credential encryption key'
    );
  end if;
end $$;

create or replace function public.althea_gateway_encryption_key()
returns text
language sql
security definer
set search_path = pg_catalog, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'althea_gateway_encryption_key'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.althea_gateway_encryption_key() from public, anon, authenticated;
grant execute on function public.althea_gateway_encryption_key() to service_role;

alter table public.user_gateway_credentials
  add column if not exists secret_ref text;

create index if not exists idx_user_gateway_credentials_secret_ref
  on public.user_gateway_credentials(secret_ref)
  where secret_ref is not null;

-- New writes use Vault. The RPC never returns the secret or ciphertext.
drop function if exists public.upsert_gateway_credential(text, text, jsonb, boolean, integer);

create or replace function public.upsert_gateway_credential(
  p_gateway_name text,
  p_api_key text,
  p_metadata jsonb default '{}'::jsonb,
  p_is_active boolean default true,
  p_priority_order integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare
  v_gateway_name text;
  v_secret_name text;
  v_secret_ref uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;

  v_gateway_name := lower(trim(coalesce(p_gateway_name, '')));
  if v_gateway_name = '' then
    raise exception 'gateway_name_required';
  end if;
  if length(coalesce(p_api_key, '')) < 8 then
    raise exception 'api_key_too_short';
  end if;
  if p_priority_order < 1 then
    raise exception 'priority_order_invalid';
  end if;

  -- One stable secret name per merchant + gateway. Vault owns the plaintext.
  v_secret_name := 'gateway_credential:' || auth.uid()::text || ':' || v_gateway_name;

  -- Replace the previous Vault secret atomically at the application level.
  -- vault.create_secret returns the generated UUID. The old reference is retained
  -- only until the credential row is updated, after which it is no longer active.
  select id into v_secret_ref
  from vault.secrets
  where name = v_secret_name
  order by created_at desc
  limit 1;

  if v_secret_ref is null then
    v_secret_ref := vault.create_secret(
      p_api_key,
      v_secret_name,
      'ALTHEA PAY gateway credential: ' || v_gateway_name
    );
  else
    -- Vault does not expose an UPDATE primitive through the public schema.
    -- Create a versioned replacement and point the public reference to it.
    v_secret_ref := vault.create_secret(
      p_api_key,
      v_secret_name || ':v:' || extract(epoch from clock_timestamp())::bigint,
      'ALTHEA PAY gateway credential version: ' || v_gateway_name
    );
  end if;

  insert into public.user_gateway_credentials(
    user_id,
    gateway_name,
    api_key_encrypted,
    secret_ref,
    metadata,
    is_active,
    priority_order,
    updated_at
  )
  values (
    auth.uid(),
    v_gateway_name,
    null,
    v_secret_ref::text,
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_is_active, true),
    p_priority_order,
    timezone('utc', now())
  )
  on conflict (user_id, gateway_name) do update set
    api_key_encrypted = null,
    secret_ref = excluded.secret_ref,
    metadata = excluded.metadata,
    is_active = excluded.is_active,
    priority_order = excluded.priority_order,
    updated_at = timezone('utc', now())
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'gateway_name', v_gateway_name,
    'is_active', coalesce(p_is_active, true),
    'priority_order', p_priority_order,
    'secret_stored', true
  );
end;
$$;

revoke all on function public.upsert_gateway_credential(text, text, jsonb, boolean, integer) from public, anon;
grant execute on function public.upsert_gateway_credential(text, text, jsonb, boolean, integer) to authenticated;

-- Server-only credential resolution. This is the only supported plaintext read path.
create or replace function public.resolve_gateway_credential(p_credential_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare
  v_role text;
  v_gateway public.user_gateway_credentials%rowtype;
  v_secret text;
begin
  v_role := coalesce(auth.role(), '');
  if v_role <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select * into v_gateway
  from public.user_gateway_credentials
  where id = p_credential_id
    and is_active = true
  limit 1;

  if not found then
    raise exception 'gateway_credential_not_found';
  end if;

  if v_gateway.secret_ref is not null then
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where id = v_gateway.secret_ref::uuid
    limit 1;
  elsif v_gateway.api_key_encrypted is not null then
    -- Legacy compatibility only. New writes never use this branch.
    v_secret := extensions.pgp_sym_decrypt(
      decode(v_gateway.api_key_encrypted, 'base64'),
      public.althea_gateway_encryption_key()
    );
  end if;

  if coalesce(v_secret, '') = '' then
    raise exception 'gateway_credential_secret_unavailable';
  end if;

  return jsonb_build_object(
    'id', v_gateway.id,
    'gateway_name', v_gateway.gateway_name,
    'api_key', v_secret,
    'metadata', coalesce(v_gateway.metadata, '{}'::jsonb),
    'priority_order', v_gateway.priority_order
  );
end;
$$;

revoke all on function public.resolve_gateway_credential(uuid) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential(uuid) to service_role;

comment on table public.user_gateway_credentials is
  'Gateway routing metadata. New gateway secrets are stored in Supabase Vault and referenced by secret_ref; plaintext is never exposed to browser clients.';
comment on column public.user_gateway_credentials.secret_ref is
  'Supabase Vault secret UUID. Server-side only.';
comment on column public.user_gateway_credentials.api_key_encrypted is
  'Legacy ciphertext compatibility column. New credentials use secret_ref and this column is set NULL.';
