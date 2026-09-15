begin;

alter table public.funnel_steps add column if not exists organization_id uuid;
alter table public.integration_events add column if not exists organization_id uuid;
alter table public.webhook_integrations add column if not exists organization_id uuid;

update public.funnel_steps fs set organization_id=f.organization_id from public.funnels f where f.id=fs.funnel_id and fs.organization_id is null;
update public.integration_events ie set organization_id=f.organization_id from public.funnels f where f.id=ie.funnel_id and ie.organization_id is null;
update public.webhook_integrations wi set organization_id=f.organization_id from public.funnels f where f.id=wi.funnel_id and wi.organization_id is null;

alter table public.funnel_steps alter column organization_id set not null;
alter table public.integration_events alter column organization_id set not null;
alter table public.webhook_integrations alter column organization_id set not null;

create index if not exists funnel_steps_org_funnel_idx on public.funnel_steps(organization_id, funnel_id);
create index if not exists integration_events_org_funnel_created_idx on public.integration_events(organization_id, funnel_id, created_at desc);
create index if not exists webhook_integrations_org_funnel_idx on public.webhook_integrations(organization_id, funnel_id);

drop policy if exists funnel_steps_owner_select on public.funnel_steps;
drop policy if exists funnel_steps_owner_insert on public.funnel_steps;
drop policy if exists funnel_steps_owner_update on public.funnel_steps;
drop policy if exists funnel_steps_owner_delete on public.funnel_steps;
create policy funnel_steps_tenant_select on public.funnel_steps for select to authenticated using (private.is_org_member(organization_id));
create policy funnel_steps_tenant_insert on public.funnel_steps for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','operator']) and exists (select 1 from public.funnels f where f.id=funnel_steps.funnel_id and f.organization_id=funnel_steps.organization_id));
create policy funnel_steps_tenant_update on public.funnel_steps for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','operator'])) with check (private.has_org_role(organization_id, array['owner','admin','manager','operator']) and exists (select 1 from public.funnels f where f.id=funnel_steps.funnel_id and f.organization_id=funnel_steps.organization_id));
create policy funnel_steps_tenant_delete on public.funnel_steps for delete to authenticated using (private.has_org_role(organization_id, array['owner','admin']));

drop policy if exists integration_events_owner on public.integration_events;
create policy integration_events_tenant_select on public.integration_events for select to authenticated using (private.is_org_member(organization_id));
create policy integration_events_tenant_insert on public.integration_events for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','operator']) and exists (select 1 from public.funnels f where f.id=integration_events.funnel_id and f.organization_id=integration_events.organization_id));
create policy integration_events_tenant_update on public.integration_events for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','operator'])) with check (private.has_org_role(organization_id, array['owner','admin','manager','operator']));
create policy integration_events_tenant_delete on public.integration_events for delete to authenticated using (private.has_org_role(organization_id, array['owner','admin']));

drop policy if exists webhook_integrations_select_own on public.webhook_integrations;
drop policy if exists webhook_integrations_insert_own on public.webhook_integrations;
drop policy if exists webhook_integrations_update_own on public.webhook_integrations;
create policy webhook_integrations_tenant_select on public.webhook_integrations for select to authenticated using (private.is_org_member(organization_id));
create policy webhook_integrations_tenant_insert on public.webhook_integrations for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','operator']) and exists (select 1 from public.funnels f where f.id=webhook_integrations.funnel_id and f.organization_id=webhook_integrations.organization_id));
create policy webhook_integrations_tenant_update on public.webhook_integrations for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','operator'])) with check (private.has_org_role(organization_id, array['owner','admin','manager','operator']) and exists (select 1 from public.funnels f where f.id=webhook_integrations.funnel_id and f.organization_id=webhook_integrations.organization_id));
create policy webhook_integrations_tenant_delete on public.webhook_integrations for delete to authenticated using (private.has_org_role(organization_id, array['owner','admin']));

commit;
