begin;

create or replace function public.resolve_gateway_credential_for_gateway(p_gateway_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_catalog
as $$
declare
  g public.gateways%rowtype;
  base_bundle jsonb;
  registry_config jsonb;
  webhook_config jsonb;
  merged_credentials jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  select * into g
  from public.gateways
  where id = p_gateway_id
    and credential_id is not null
  limit 1;

  if not found then
    raise exception 'gateway_credential_not_bound';
  end if;

  select public.resolve_gateway_credential(g.credential_id)
    into base_bundle;

  if jsonb_typeof(base_bundle) <> 'object' then
    raise exception 'gateway_credential_bundle_invalid';
  end if;

  select coalesce(r.execution_config,'{}'::jsonb), coalesce(r.webhook_config,'{}'::jsonb)
    into registry_config, webhook_config
  from public.gateway_provider_registry r
  where r.provider_key = lower(trim(g.provider))
    and r.is_active = true
  limit 1;

  if registry_config is null then
    raise exception 'provider_not_registered';
  end if;

  merged_credentials := registry_config || coalesce(base_bundle->'credentials','{}'::jsonb);

  return base_bundle
    || jsonb_build_object(
      'gateway_id', g.id,
      'provider', g.provider,
      'environment', g.environment,
      'credentials', merged_credentials,
      'provider_config', registry_config,
      'webhook_config', webhook_config
    );
end;
$$;

revoke all on function public.resolve_gateway_credential_for_gateway(text) from public, anon, authenticated;
grant execute on function public.resolve_gateway_credential_for_gateway(text) to service_role;

commit;