begin;

alter table public.gateway_provider_registry
  add column if not exists execution_config jsonb not null default '{}'::jsonb,
  add column if not exists webhook_config jsonb not null default '{}'::jsonb,
  add column if not exists schema_version integer not null default 1;

alter table public.gateway_provider_registry drop constraint if exists gateway_provider_registry_execution_config_chk;
alter table public.gateway_provider_registry add constraint gateway_provider_registry_execution_config_chk check (jsonb_typeof(execution_config) = 'object');
alter table public.gateway_provider_registry drop constraint if exists gateway_provider_registry_webhook_config_chk;
alter table public.gateway_provider_registry add constraint gateway_provider_registry_webhook_config_chk check (jsonb_typeof(webhook_config) = 'object');
create index if not exists gateway_provider_registry_operational_idx on public.gateway_provider_registry(is_active, operational, provider_key);

update public.gateway_provider_registry set credential_schema = jsonb_build_object('fields', jsonb_build_array(jsonb_build_object('name','api_key','label','API Key / Token','type','password','required',false), jsonb_build_object('name','access_token','label','Access Token','type','password','required',false), jsonb_build_object('name','secret_key','label','Secret Key','type','password','required',false), jsonb_build_object('name','token','label','Token','type','password','required',false))), execution_config = jsonb_build_object('base_url','','create_path','/payments','create_method','POST','status_path','/payments/{id}','status_method','GET','refund_path','/payments/{id}/refund','refund_method','POST','health_path','/health','health_method','GET','request_template','','response_mapping',jsonb_build_object('id','id','status','status','amount','amount','currency','currency'),'status_mapping',jsonb_build_object(),'custom_headers',jsonb_build_object(),'idempotency_header','Idempotency-Key'), schema_version=1, updated_at=now() where provider_key='generic_http';
update public.gateway_provider_registry set execution_config=(select execution_config from public.gateway_provider_registry where provider_key='generic_http'), webhook_config=(select webhook_config from public.gateway_provider_registry where provider_key='generic_http'), schema_version=1, updated_at=now() where provider_key='custom_rest';

create or replace function public.register_gateway_provider_definition(p_provider_key text,p_display_name text,p_credential_schema jsonb default '{"fields":[]}'::jsonb,p_capabilities jsonb default '{}'::jsonb,p_adapter_key text default null,p_adapter_url text default null,p_execution_config jsonb default '{}'::jsonb,p_webhook_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare k text:=lower(trim(p_provider_key)); a text:=nullif(lower(trim(coalesce(p_adapter_key,p_provider_key))),''); u text:=nullif(trim(p_adapter_url),''); r public.gateway_provider_registry%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'forbidden'; end if;
 if k is null or k !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'invalid_provider_key'; end if;
 if a is null or a !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then raise exception 'invalid_adapter_key'; end if;
 if u is not null and u !~ '^https://' then raise exception 'adapter_https_required'; end if;
 if jsonb_typeof(coalesce(p_credential_schema,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_capabilities,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_execution_config,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_webhook_config,'{}'::jsonb))<>'object' then raise exception 'invalid_provider_schema'; end if;
 insert into public.gateway_provider_registry(provider_key,display_name,credential_schema,capabilities,adapter_key,adapter_url,operational,is_active,execution_config,webhook_config,schema_version,updated_at) values(k,trim(p_display_name),coalesce(p_credential_schema,'{}'::jsonb),coalesce(p_capabilities,'{}'::jsonb),a,u,true,true,coalesce(p_execution_config,'{}'::jsonb),coalesce(p_webhook_config,'{}'::jsonb),1,now()) on conflict(provider_key) do update set display_name=excluded.display_name,credential_schema=excluded.credential_schema,capabilities=excluded.capabilities,adapter_key=excluded.adapter_key,adapter_url=excluded.adapter_url,operational=excluded.operational,is_active=true,execution_config=excluded.execution_config,webhook_config=excluded.webhook_config,schema_version=excluded.schema_version,updated_at=now() returning * into r;
 return jsonb_build_object('provider_key',r.provider_key,'display_name',r.display_name,'adapter_key',r.adapter_key,'adapter_url',r.adapter_url,'operational',r.operational,'is_active',r.is_active,'schema_version',r.schema_version);
end $$;
revoke all on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.register_gateway_provider_definition(text,text,jsonb,jsonb,text,text,jsonb,jsonb) to service_role;

create or replace function public.resolve_gateway_credential_bundle(p_gateway_id text)
returns jsonb language plpgsql security definer set search_path=public,vault,pg_catalog as $$
declare g public.gateways%rowtype; c public.user_gateway_credentials%rowtype; r public.gateway_provider_registry%rowtype; secret text; credential_json jsonb; merged jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'forbidden'; end if;
 select * into g from public.gateways where id=p_gateway_id limit 1; if not found or g.credential_id is null then raise exception 'gateway_credential_not_bound'; end if;
 select * into c from public.user_gateway_credentials where id=g.credential_id and is_active=true limit 1; if not found or c.secret_ref is null then raise exception 'gateway_credential_not_found'; end if;
 select * into r from public.gateway_provider_registry where provider_key=lower(trim(g.provider)) and is_active=true limit 1; if not found then raise exception 'provider_not_registered'; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=c.secret_ref::uuid limit 1; if coalesce(secret,'')='' then raise exception 'gateway_credential_secret_unavailable'; end if;
 begin credential_json:=secret::jsonb; exception when others then raise exception 'gateway_credential_bundle_invalid'; end;
 if jsonb_typeof(credential_json)<>'object' then raise exception 'gateway_credential_bundle_invalid'; end if;
 merged:=coalesce(r.execution_config,'{}'::jsonb)||credential_json;
 return jsonb_build_object('id',c.id,'gateway_id',g.id,'provider',g.provider,'environment',g.environment,'credentials',merged,'provider_config',coalesce(r.execution_config,'{}'::jsonb),'webhook_config',coalesce(r.webhook_config,'{}'::jsonb),'metadata',coalesce(c.metadata,'{}'::jsonb),'priority_order',c.priority_order);
end $$;
revoke all on function public.resolve_gateway_credential_bundle(text) from public,anon,authenticated;
grant execute on function public.resolve_gateway_credential_bundle(text) to service_role;

commit;