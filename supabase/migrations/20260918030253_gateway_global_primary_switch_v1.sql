begin;

create or replace function public.switch_funnel_primary_gateway(
  p_funnel_id text,
  p_gateway_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  u uuid := auth.uid();
  funnel_org uuid;
  gateway_org uuid;
  old_gateway_id text;
  binding_id uuid;
begin
  if u is null then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  select f.organization_id
    into funnel_org
  from public.funnels f
  where f.id = p_funnel_id
    and f.deleted_at is null;

  if funnel_org is null then
    raise exception 'funnel_not_found' using errcode='P0002';
  end if;

  select g.organization_id
    into gateway_org
  from public.gateways g
  where g.id = p_gateway_id
    and lower(coalesce(g.status, '')) in ('connected', 'degraded');

  if gateway_org is null then
    raise exception 'gateway_not_operational' using errcode='P0002';
  end if;

  if funnel_org <> gateway_org then
    raise exception 'funnel_gateway_organization_mismatch' using errcode='23514';
  end if;

  if not private.has_org_role(
    funnel_org,
    array['owner','admin','manager','operator','supervisor']
  ) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(funnel_org::text || ':funnel-gateway:' || p_funnel_id, 0)
  );

  select gateway_id
    into old_gateway_id
  from public.funnel_gateway_bindings
  where organization_id = funnel_org
    and funnel_id = p_funnel_id
    and is_primary = true
    and status = 'active'
  limit 1;

  if old_gateway_id is not distinct from p_gateway_id then
    select id
      into binding_id
    from public.funnel_gateway_bindings
    where organization_id = funnel_org
      and funnel_id = p_funnel_id
      and gateway_id = p_gateway_id
    limit 1;
  else
    update public.funnel_gateway_bindings
       set is_primary = false,
           updated_at = now()
     where organization_id = funnel_org
       and funnel_id = p_funnel_id
       and is_primary = true;

    insert into public.funnel_gateway_bindings(
      organization_id,
      funnel_id,
      gateway_id,
      role,
      priority,
      is_primary,
      status
    )
    values(
      funnel_org,
      p_funnel_id,
      p_gateway_id,
      'payment',
      1,
      true,
      'active'
    )
    on conflict (funnel_id, gateway_id) do update
      set organization_id = excluded.organization_id,
          role = 'payment',
          priority = 1,
          is_primary = true,
          status = 'active',
          updated_at = now()
    returning id into binding_id;
  end if;

  return jsonb_build_object(
    'binding_id', binding_id,
    'funnel_id', p_funnel_id,
    'previous_gateway_id', old_gateway_id,
    'gateway_id', p_gateway_id,
    'is_primary', true,
    'status', 'active'
  );
end;
$function$;

revoke all on function public.switch_funnel_primary_gateway(text, text) from public, anon;
grant execute on function public.switch_funnel_primary_gateway(text, text) to authenticated;

create or replace function public.switch_all_funnel_primary_gateways(
  p_gateway_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  u uuid := auth.uid();
  target_org uuid;
  target_funnel record;
  switched_count integer := 0;
  switched_funnels text[] := array[]::text[];
begin
  if u is null then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  select g.organization_id
    into target_org
  from public.gateways g
  where g.id = p_gateway_id
    and lower(coalesce(g.status, '')) in ('connected', 'degraded');

  if target_org is null then
    raise exception 'gateway_not_operational' using errcode='P0002';
  end if;

  if not private.has_org_role(
    target_org,
    array['owner','admin','manager','operator','supervisor']
  ) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_org::text || ':global-funnel-gateway-switch', 0)
  );

  for target_funnel in
    select distinct f.id
    from public.funnels f
    join public.funnel_gateway_bindings b
      on b.organization_id = f.organization_id
     and b.funnel_id = f.id
     and b.is_primary = true
     and b.status = 'active'
    where f.organization_id = target_org
      and f.deleted_at is null
    order by f.id
  loop
    perform public.switch_funnel_primary_gateway(target_funnel.id, p_gateway_id);
    switched_count := switched_count + 1;
    switched_funnels := array_append(switched_funnels, target_funnel.id);
  end loop;

  return jsonb_build_object(
    'gateway_id', p_gateway_id,
    'organization_id', target_org,
    'switched_count', switched_count,
    'funnel_ids', to_jsonb(switched_funnels)
  );
end;
$function$;

revoke all on function public.switch_all_funnel_primary_gateways(text) from public, anon;
grant execute on function public.switch_all_funnel_primary_gateways(text) to authenticated;

comment on function public.switch_all_funnel_primary_gateways(text) is
  'Atomically makes one operational gateway primary for every non-deleted funnel in the same organization that already has an active primary gateway. Existing transactions are not modified.';

commit;
