create or replace function public.provision_sandbox_gateway(p_funnel_id text default null)
returns table(gateway_id text, route_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_gateway_id text;
  v_route_count integer := 0;
  v_inserted integer := 0;
  v_funnel_id text;
begin
  if v_user is null then raise exception 'unauthorized'; end if;

  if p_funnel_id is not null and not exists (
    select 1 from public.funnels f where f.id=p_funnel_id and f.user_id=v_user and f.deleted_at is null
  ) then raise exception 'funnel_not_found'; end if;

  select g.id into v_gateway_id
  from public.gateways g
  where g.user_id=v_user
    and lower(coalesce(g.data->>'provider','')) in ('sandbox','simulated')
    and lower(coalesce(g.data->>'environment','sandbox'))='sandbox'
  order by g.created_at asc limit 1;

  if v_gateway_id is null then
    v_gateway_id := 'sandbox_' || replace(gen_random_uuid()::text,'-','');
    insert into public.gateways(id,user_id,data) values (
      v_gateway_id,v_user,jsonb_build_object(
        'name','ALTHEA Sandbox','provider','sandbox','environment','sandbox','status','active',
        'capabilities',jsonb_build_array('create_payment','refund','chargeback_simulation','technical_failure_simulation','card_decline_simulation'),
        'custody',false
      )
    );
  end if;

  if p_funnel_id is not null then
    insert into public.gateway_routes(user_id,funnel_id,product_id,gateway_id,priority,enabled,fallback_enabled,conditions)
    select v_user,p_funnel_id,null,v_gateway_id,10,true,true,jsonb_build_object('health_guard',true,'environment','sandbox')
    where not exists (
      select 1 from public.gateway_routes r
      where r.user_id=v_user and r.funnel_id=p_funnel_id and r.product_id is null and r.gateway_id=v_gateway_id
    );
    get diagnostics v_inserted = row_count;
    v_route_count := v_inserted;
  else
    for v_funnel_id in select f.id from public.funnels f where f.user_id=v_user and f.deleted_at is null loop
      insert into public.gateway_routes(user_id,funnel_id,product_id,gateway_id,priority,enabled,fallback_enabled,conditions)
      select v_user,v_funnel_id,null,v_gateway_id,10,true,true,jsonb_build_object('health_guard',true,'environment','sandbox')
      where not exists (
        select 1 from public.gateway_routes r
        where r.user_id=v_user and r.funnel_id=v_funnel_id and r.product_id is null and r.gateway_id=v_gateway_id
      );
      get diagnostics v_inserted = row_count;
      v_route_count := v_route_count + v_inserted;
    end loop;
  end if;

  return query select v_gateway_id,v_route_count;
end;
$$;

revoke all on function public.provision_sandbox_gateway(text) from public;
revoke all on function public.provision_sandbox_gateway(text) from anon;
grant execute on function public.provision_sandbox_gateway(text) to authenticated;
