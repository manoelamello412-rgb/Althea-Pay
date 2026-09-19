create or replace function public.enforce_gateway_policy_authority() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.enabled then
    if exists (select 1 from public.gateway_routing_policies p where p.user_id=new.user_id and p.funnel_id=new.funnel_id and p.is_active=true) then
      new.enabled := false;
      new.fallback_enabled := false;
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.enforce_gateway_policy_authority() from public,anon,authenticated;
create or replace trigger trg_gateway_route_policy_authority
before insert or update of enabled,funnel_id,user_id on public.gateway_routes
for each row execute function public.enforce_gateway_policy_authority();

update public.gateway_routes r
set enabled=false,fallback_enabled=false
where r.enabled=true
  and exists (select 1 from public.gateway_routing_policies p where p.user_id=r.user_id and p.funnel_id=r.funnel_id and p.is_active=true);
