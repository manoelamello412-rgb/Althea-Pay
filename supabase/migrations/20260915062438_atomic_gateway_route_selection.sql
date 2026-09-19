begin;
create or replace function public.select_gateway_for_funnel(p_user_id uuid,p_funnel_id text,p_product_id text default null)
returns table(gateway_id text,route_id uuid,decision_reason text,priority integer)
language plpgsql
security definer
set search_path = public
as $$
declare v_override record; v_route record;
begin
  if p_user_id is null or p_funnel_id is null or btrim(p_funnel_id) = '' then raise exception using errcode='22023',message='invalid_route_scope'; end if;
  if not exists(select 1 from public.funnels f where f.id=p_funnel_id and f.user_id=p_user_id and f.deleted_at is null) then raise exception using errcode='42501',message='funnel_not_owned'; end if;
  select o.forced_gateway_id,o.reason into v_override from public.gateway_routing_overrides o where o.user_id=p_user_id and o.funnel_id=p_funnel_id and o.active=true and o.starts_at<=now() and o.expires_at>now() order by o.created_at desc limit 1;
  if v_override.forced_gateway_id is not null then
    if exists(select 1 from public.gateways g where g.id=v_override.forced_gateway_id and g.user_id=p_user_id and g.status in ('connected','degraded')) then
      return query select v_override.forced_gateway_id::text,null::uuid,coalesce(v_override.reason,'forced_override'),0; return;
    end if;
  end if;
  select r.gateway_id,r.id,r.priority into v_route from public.gateway_routes r join public.gateways g on g.id=r.gateway_id and g.user_id=r.user_id where r.user_id=p_user_id and r.funnel_id=p_funnel_id and r.enabled=true and g.status in ('connected','degraded') and (r.product_id is null or r.product_id=p_product_id) order by case when r.product_id is not null and r.product_id=p_product_id then 0 else 1 end,r.priority asc,r.created_at asc limit 1;
  if v_route.gateway_id is null then raise exception using errcode='P0002',message='no_operational_gateway_route'; end if;
  return query select v_route.gateway_id::text,v_route.id,'configured_route',v_route.priority;
end;
$$;
revoke all on function public.select_gateway_for_funnel(uuid,text,text) from public;
grant execute on function public.select_gateway_for_funnel(uuid,text,text) to service_role;
commit;