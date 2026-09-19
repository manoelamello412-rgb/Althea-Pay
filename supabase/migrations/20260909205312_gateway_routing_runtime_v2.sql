create or replace function public.get_active_gateway_routing_policy(p_user_id uuid, p_funnel_id text)
returns table(policy_id uuid, policy_version bigint, routing_graph jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select p.id, p.version, p.routing_graph
  from public.gateway_routing_policies p
  where p.user_id = p_user_id
    and p.funnel_id = p_funnel_id
    and p.is_active = true
  order by p.updated_at desc
  limit 1;
end;
$$;
revoke all on function public.get_active_gateway_routing_policy(uuid,text) from public, anon, authenticated;
grant execute on function public.get_active_gateway_routing_policy(uuid,text) to service_role;

create index if not exists gateway_routing_policies_active_lookup_idx
  on public.gateway_routing_policies(user_id, funnel_id, is_active, updated_at desc);
