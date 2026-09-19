alter table public.gateway_provider_registry add column if not exists adapter_key varchar(80);
alter table public.gateway_provider_registry add column if not exists operational boolean not null default false;
alter table public.gateway_provider_registry add constraint gateway_provider_registry_adapter_key_chk check (adapter_key is null or adapter_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$');
update public.gateway_provider_registry set adapter_key=provider_key, operational=(provider_key in ('stripe','asaas','mercado_pago')) where adapter_key is null;
update public.gateway_provider_registry set operational=false where provider_key='adyen';

create or replace function public.register_dynamic_gateway(p_provider_key text,p_display_name text,p_environment text,p_credentials jsonb,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, vault, pg_catalog as $$
declare
  u uuid := auth.uid(); r public.gateway_provider_registry%rowtype; c uuid; s uuid; secret_name text; gateway_id_text text;
  env text := lower(trim(coalesce(p_environment,'production'))); clean_name text := nullif(trim(p_display_name),''); gateway_status text;
begin
  if u is null then raise exception 'unauthorized'; end if;
  if env not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
  if clean_name is null or length(clean_name) > 120 then raise exception 'invalid_display_name'; end if;
  select * into r from public.gateway_provider_registry where provider_key=lower(trim(p_provider_key)) and is_active=true limit 1;
  if not found then raise exception 'provider_not_registered'; end if;
  if not public.validate_gateway_credential_schema(r.credential_schema,p_credentials) then raise exception 'credential_schema_validation_failed'; end if;
  secret_name := 'gateway_credential_bundle:'||u::text||':'||r.provider_key||':'||replace(gen_random_uuid()::text,'-','');
  s := vault.create_secret(p_credentials::text, secret_name, 'ALTHEA PAY dynamic gateway credential bundle: '||r.provider_key);
  insert into public.user_gateway_credentials(user_id,gateway_name,api_key_encrypted,secret_ref,metadata,is_active,priority_order,updated_at)
  values(u, lower(r.provider_key)||':'||lower(regexp_replace(clean_name,'[^a-zA-Z0-9]+','_','g')), null, s::text, coalesce(p_metadata,'{}'::jsonb), true, 1, timezone('utc',now()))
  on conflict (user_id,gateway_name) do update set api_key_encrypted=null,secret_ref=excluded.secret_ref,metadata=excluded.metadata,is_active=true,updated_at=timezone('utc',now())
  returning id into c;
  gateway_id_text := 'gw_'||replace(gen_random_uuid()::text,'-','');
  gateway_status := case when r.operational then 'active' else 'inactive' end;
  insert into public.gateways(id,user_id,provider,display_name,environment,status,capabilities,credential_id)
  values(gateway_id_text,u,r.provider_key,clean_name,env,gateway_status,coalesce(r.capabilities,'{}'::jsonb),c);
  return jsonb_build_object('gateway_id',gateway_id_text,'credential_id',c,'provider_key',r.provider_key,'environment',env,'status',gateway_status,'operational',r.operational,'adapter_key',r.adapter_key);
end $$;
revoke all on function public.register_dynamic_gateway(text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.register_dynamic_gateway(text,text,text,jsonb,jsonb) to authenticated;