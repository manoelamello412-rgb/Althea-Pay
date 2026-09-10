alter table public.gateway_provider_registry add column if not exists adapter_url text;
alter table public.gateway_provider_registry add constraint gateway_provider_registry_adapter_url_chk check (adapter_url is null or adapter_url ~ '^https://');
create or replace function public.register_gateway_provider_definition(p_provider_key text,p_display_name text,p_credential_schema jsonb default '{"fields":[]}'::jsonb,p_capabilities jsonb default '{}'::jsonb,p_adapter_key text default null,p_adapter_url text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare k text:=lower(trim(p_provider_key)); a text:=nullif(lower(trim(coalesce(p_adapter_key,p_provider_key))), ''); u text:=nullif(trim(p_adapter_url),''); r public.gateway_provider_registry%rowtype;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if;
 if k is null or k !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'invalid_provider_key'; end if;
 if a is null or a !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'invalid_adapter_key'; end if;
 if u is not null and u !~ '^https://' then raise exception 'adapter_https_required'; end if;
 if jsonb_typeof(coalesce(p_credential_schema,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_capabilities,'{}'::jsonb))<>'object' then raise exception 'invalid_provider_schema'; end if;
 insert into public.gateway_provider_registry(provider_key,display_name,credential_schema,capabilities,adapter_key,adapter_url,operational,is_active,updated_at)
 values(k,trim(p_display_name),coalesce(p_credential_schema,'{}'::jsonb),coalesce(p_capabilities,'{}'::jsonb),a,u,(u is not null),true,now())
 on conflict(provider_key) do update set display_name=excluded.display_name,credential_schema=excluded.credential_schema,capabilities=excluded.capabilities,adapter_key=excluded.adapter_key,adapter_url=excluded.adapter_url,operational=excluded.operational,is_active=true,updated_at=now()
 returning * into r;
 return jsonb_build_object('provider_key',r.provider_key,'display_name',r.display_name,'adapter_key',r.adapter_key,'adapter_url',r.adapter_url,'operational',r.operational,'is_active',r.is_active);
end $$;
revoke all on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text) to service_role;
