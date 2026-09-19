create or replace function public.resolve_gateway_credential(p_credential_id uuid)
returns jsonb language plpgsql security definer set search_path = public, vault, pg_catalog as $$
declare v_gateway public.user_gateway_credentials%rowtype; v_secret text; v_json jsonb; v_api_key text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if;
  select * into v_gateway from public.user_gateway_credentials where id=p_credential_id and is_active=true limit 1;
  if not found then raise exception 'gateway_credential_not_found'; end if;
  if v_gateway.secret_ref is not null then
    select decrypted_secret into v_secret from vault.decrypted_secrets where id=v_gateway.secret_ref::uuid limit 1;
  elsif v_gateway.api_key_encrypted is not null then
    v_secret := extensions.pgp_sym_decrypt(decode(v_gateway.api_key_encrypted,'base64'),public.althea_gateway_encryption_key());
  end if;
  if coalesce(v_secret,'')='' then raise exception 'gateway_credential_secret_unavailable'; end if;
  begin v_json := v_secret::jsonb; exception when others then v_json := null; end;
  if jsonb_typeof(v_json)='object' then
    v_api_key := coalesce(nullif(v_json->>'api_key',''),nullif(v_json->>'access_token',''),nullif(v_json->>'secret_key',''));
    return jsonb_build_object('id',v_gateway.id,'gateway_name',v_gateway.gateway_name,'api_key',v_api_key,'credentials',v_json,'metadata',coalesce(v_gateway.metadata,'{}'::jsonb),'priority_order',v_gateway.priority_order);
  end if;
  return jsonb_build_object('id',v_gateway.id,'gateway_name',v_gateway.gateway_name,'api_key',v_secret,'metadata',coalesce(v_gateway.metadata,'{}'::jsonb),'priority_order',v_gateway.priority_order);
end $$;
revoke all on function public.resolve_gateway_credential(uuid) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential(uuid) to service_role;