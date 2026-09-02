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
set search_path = public, extensions
as $$
declare
  v_key text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if length(trim(coalesce(p_gateway_name, ''))) = 0 then raise exception 'gateway_name_required'; end if;
  if length(coalesce(p_api_key, '')) < 8 then raise exception 'api_key_too_short'; end if;
  if p_priority_order < 1 then raise exception 'priority_order_invalid'; end if;
  v_key := current_setting('app.settings.gateway_encryption_key', true);
  if coalesce(v_key, '') = '' then raise exception 'gateway_encryption_key_not_configured'; end if;
  insert into public.user_gateway_credentials(user_id, gateway_name, api_key_encrypted, secret_ref, metadata, is_active, priority_order)
  values (auth.uid(), lower(trim(p_gateway_name)), encode(pgp_sym_encrypt(p_api_key, v_key, 'cipher-algo=aes256'), 'base64'), null, coalesce(p_metadata, '{}'::jsonb), coalesce(p_is_active, true), p_priority_order)
  on conflict (user_id, gateway_name) do update set
    api_key_encrypted = excluded.api_key_encrypted,
    secret_ref = null,
    metadata = excluded.metadata,
    is_active = excluded.is_active,
    priority_order = excluded.priority_order,
    updated_at = timezone('utc', now())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'gateway_name', lower(trim(p_gateway_name)), 'is_active', coalesce(p_is_active, true), 'priority_order', p_priority_order);
end;
$$;

revoke all on function public.upsert_gateway_credential(text, text, jsonb, boolean, integer) from public;
grant execute on function public.upsert_gateway_credential(text, text, jsonb, boolean, integer) to authenticated;
