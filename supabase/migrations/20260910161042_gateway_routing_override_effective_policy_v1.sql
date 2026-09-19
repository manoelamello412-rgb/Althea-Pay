create or replace function public.get_effective_gateway_override(p_user_id uuid,p_funnel_id text)
returns table(gateway_id text, expires_at timestamptz) language sql stable security definer set search_path=public,pg_catalog as $$ select o.forced_gateway_id,o.expires_at from public.gateway_routing_overrides o join public.gateways g on g.id=o.forced_gateway_id and g.user_id=o.user_id where o.user_id=p_user_id and o.funnel_id=p_funnel_id and o.active=true and o.expires_at>now() and g.status in ('connected','degraded') limit 1 $$;
revoke all on function public.get_effective_gateway_override(uuid,text) from public,anon,authenticated;
grant execute on function public.get_effective_gateway_override(uuid,text) to service_role;
