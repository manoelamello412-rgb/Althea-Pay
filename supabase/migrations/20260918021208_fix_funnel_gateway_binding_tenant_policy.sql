-- Correct tenant correlation in funnel gateway binding write policies.
-- The previous policy compared f.organization_id/g.organization_id to themselves,
-- which did not prove that the referenced funnel and gateway belonged to the binding organization.

drop policy if exists funnel_gateway_bindings_insert on public.funnel_gateway_bindings;
create policy funnel_gateway_bindings_insert
on public.funnel_gateway_bindings
for insert
to authenticated
with check (
  private.has_org_role(
    public.funnel_gateway_bindings.organization_id,
    array['owner','admin','manager','operator','supervisor']
  )
  and exists (
    select 1
    from public.funnels f
    where f.id = public.funnel_gateway_bindings.funnel_id
      and f.organization_id = public.funnel_gateway_bindings.organization_id
  )
  and exists (
    select 1
    from public.gateways g
    where g.id = public.funnel_gateway_bindings.gateway_id
      and g.organization_id = public.funnel_gateway_bindings.organization_id
  )
);

drop policy if exists funnel_gateway_bindings_update on public.funnel_gateway_bindings;
create policy funnel_gateway_bindings_update
on public.funnel_gateway_bindings
for update
to authenticated
using (
  private.has_org_role(
    public.funnel_gateway_bindings.organization_id,
    array['owner','admin','manager','operator','supervisor']
  )
)
with check (
  private.has_org_role(
    public.funnel_gateway_bindings.organization_id,
    array['owner','admin','manager','operator','supervisor']
  )
  and exists (
    select 1
    from public.funnels f
    where f.id = public.funnel_gateway_bindings.funnel_id
      and f.organization_id = public.funnel_gateway_bindings.organization_id
  )
  and exists (
    select 1
    from public.gateways g
    where g.id = public.funnel_gateway_bindings.gateway_id
      and g.organization_id = public.funnel_gateway_bindings.organization_id
  )
);
