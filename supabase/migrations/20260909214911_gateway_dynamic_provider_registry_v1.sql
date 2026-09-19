create table if not exists public.gateway_provider_registry (
  id uuid primary key default gen_random_uuid(),
  provider_key varchar(80) not null unique,
  display_name varchar(120) not null,
  credential_schema jsonb not null default '{"fields":[]}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  is_custom_or_webhook_only boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gateway_provider_registry_key_chk check (provider_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  constraint gateway_provider_registry_schema_chk check (jsonb_typeof(credential_schema) = 'object' and jsonb_typeof(coalesce(credential_schema->'fields','[]'::jsonb)) = 'array')
);

create index if not exists gateway_provider_registry_active_idx on public.gateway_provider_registry(is_active, provider_key);

alter table public.gateway_provider_registry enable row level security;
revoke all on table public.gateway_provider_registry from anon;
revoke all on table public.gateway_provider_registry from authenticated;
drop policy if exists gateway_provider_registry_read on public.gateway_provider_registry;
create policy gateway_provider_registry_read on public.gateway_provider_registry for select to authenticated using (is_active = true);
grant select on public.gateway_provider_registry to authenticated;

insert into public.gateway_provider_registry(provider_key, display_name, credential_schema, capabilities)
values
('stripe','Stripe','{"fields":[{"name":"public_key","label":"Public API Key","type":"text","required":true},{"name":"secret_key","label":"Secret API Key","type":"password","required":true},{"name":"webhook_secret","label":"Webhook Signing Secret","type":"password","required":false}]}','{"payments":true,"refunds":true,"webhooks":true}'),
('adyen','Adyen','{"fields":[{"name":"merchant_account","label":"Merchant Account ID","type":"text","required":true},{"name":"api_key","label":"API Key","type":"password","required":true},{"name":"live_endpoint_prefix","label":"Live Endpoint Prefix","type":"text","required":false}]}','{"payments":true,"refunds":true,"webhooks":true}'),
('asaas','Asaas','{"fields":[{"name":"api_key","label":"API Key","type":"password","required":true},{"name":"webhook_secret","label":"Webhook Access Token","type":"password","required":false}]}','{"payments":true,"refunds":true,"webhooks":true}'),
('mercado_pago','Mercado Pago','{"fields":[{"name":"access_token","label":"Access Token","type":"password","required":true},{"name":"webhook_secret","label":"Webhook Secret","type":"password","required":false}]}','{"payments":true,"refunds":true,"webhooks":true}')
on conflict (provider_key) do update set display_name=excluded.display_name, credential_schema=excluded.credential_schema, capabilities=excluded.capabilities, is_active=true, updated_at=now();

create or replace function public.validate_gateway_credential_schema(p_schema jsonb, p_credentials jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  f jsonb;
  name text;
  typ text;
  required boolean;
  value jsonb;
begin
  if jsonb_typeof(p_schema) <> 'object' or jsonb_typeof(p_credentials) <> 'object' then return false; end if;
  if jsonb_typeof(coalesce(p_schema->'fields','[]'::jsonb)) <> 'array' then return false; end if;
  for f in select value from jsonb_array_elements(p_schema->'fields') loop
    name := nullif(trim(f->>'name'),''); typ := lower(coalesce(f->>'type','text')); required := coalesce((f->>'required')::boolean,false);
    if name is null or typ not in ('text','password') then return false; end if;
    value := p_credentials->name;
    if required and (value is null or jsonb_typeof(value) <> 'string' or length(trim(value #>> '{}')) = 0) then return false; end if;
    if value is not null and jsonb_typeof(value) <> 'string' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function public.validate_gateway_credential_schema(jsonb,jsonb) from public, anon, authenticated;

drop function if exists public.register_dynamic_gateway(text,text,text,jsonb,jsonb);
create or replace function public.register_dynamic_gateway(p_provider_key text,p_display_name text,p_environment text,p_credentials jsonb,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, vault, pg_catalog as $$
declare
  u uuid := auth.uid(); r public.gateway_provider_registry%rowtype; c uuid; s uuid; secret_name text; gid text; gateway_id_text text;
  env text := lower(trim(coalesce(p_environment,'production')));
  clean_name text := nullif(trim(p_display_name),'');
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
  values(u, lower(r.provider_key)||':'||lower(replace(clean_name,' ','_')), null, s::text, coalesce(p_metadata,'{}'::jsonb), true, 1, timezone('utc',now()))
  on conflict (user_id,gateway_name) do update set api_key_encrypted=null,secret_ref=excluded.secret_ref,metadata=excluded.metadata,is_active=true,updated_at=timezone('utc',now())
  returning id into c;
  gateway_id_text := 'gw_'||replace(gen_random_uuid()::text,'-','');
  insert into public.gateways(id,user_id,provider,display_name,environment,status,capabilities,credential_id)
  values(gateway_id_text,u,r.provider_key,clean_name,env,'active',coalesce(r.capabilities,'{}'::jsonb),c);
  return jsonb_build_object('gateway_id',gateway_id_text,'credential_id',c,'provider_key',r.provider_key,'environment',env,'status','active');
end $$;
revoke all on function public.register_dynamic_gateway(text,text,text,jsonb,jsonb) from public, anon;
grant execute on function public.register_dynamic_gateway(text,text,text,jsonb,jsonb) to authenticated;

create or replace function public.resolve_gateway_credential_bundle(p_gateway_id text)
returns jsonb language plpgsql security definer set search_path = public, vault, pg_catalog as $$
declare g public.gateways%rowtype; c public.user_gateway_credentials%rowtype; secret text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden'; end if;
  select * into g from public.gateways where id=p_gateway_id limit 1;
  if not found or g.credential_id is null then raise exception 'gateway_credential_not_bound'; end if;
  select * into c from public.user_gateway_credentials where id=g.credential_id and is_active=true limit 1;
  if not found or c.secret_ref is null then raise exception 'gateway_credential_not_found'; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where id=c.secret_ref::uuid limit 1;
  if coalesce(secret,'')='' then raise exception 'gateway_credential_secret_unavailable'; end if;
  return jsonb_build_object('id',c.id,'gateway_id',g.id,'provider',g.provider,'credentials',secret::jsonb,'metadata',coalesce(c.metadata,'{}'::jsonb));
exception when invalid_text_representation or others then
  if sqlerrm like 'gateway_%' or sqlerrm='forbidden' then raise; end if;
  raise exception 'gateway_credential_bundle_invalid';
end $$;
revoke all on function public.resolve_gateway_credential_bundle(text) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential_bundle(text) to service_role;
