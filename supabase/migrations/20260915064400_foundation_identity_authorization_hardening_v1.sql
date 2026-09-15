-- Foundation hardening: close direct tenant-boundary bypasses on legacy operational surfaces.

-- API keys are tenant-owned. A member may only create/update keys in an organization
-- where they hold an administrative role.
drop policy if exists api_keys_insert_own on public.api_keys;
drop policy if exists api_keys_select_own on public.api_keys;
drop policy if exists api_keys_update_own on public.api_keys;
drop policy if exists tenant_api_key_read on public.api_keys;
create policy tenant_api_key_read on public.api_keys
  for select to authenticated
  using (private.is_org_member(organization_id));
create policy tenant_api_key_insert on public.api_keys
  for insert to authenticated
  with check (user_id = auth.uid() and private.has_org_role(organization_id, array['owner','admin','manager']));
create policy tenant_api_key_update on public.api_keys
  for update to authenticated
  using (user_id = auth.uid() and private.has_org_role(organization_id, array['owner','admin','manager']))
  with check (user_id = auth.uid() and private.has_org_role(organization_id, array['owner','admin','manager']));
create policy tenant_api_key_delete on public.api_keys
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','admin']));

-- Funnel connection ownership must follow the funnel tenant, never just the actor.
drop policy if exists funnel_connections_select_own on public.funnel_connections;
drop policy if exists funnel_connections_insert_own on public.funnel_connections;
drop policy if exists funnel_connections_update_own on public.funnel_connections;
drop policy if exists funnel_connections_delete_own on public.funnel_connections;
drop policy if exists tenant_select on public.funnel_connections;
drop policy if exists tenant_insert on public.funnel_connections;
drop policy if exists tenant_update on public.funnel_connections;
drop policy if exists tenant_delete on public.funnel_connections;
create policy tenant_select on public.funnel_connections
  for select to authenticated using (private.is_org_member(organization_id));
create policy tenant_insert on public.funnel_connections
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','admin','manager','operator'])
    and exists (select 1 from public.funnels f where f.id = funnel_id and f.organization_id = organization_id));
create policy tenant_update on public.funnel_connections
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','admin','manager','operator']))
  with check (private.has_org_role(organization_id, array['owner','admin','manager','operator'])
    and exists (select 1 from public.funnels f where f.id = funnel_id and f.organization_id = organization_id));
create policy tenant_delete on public.funnel_connections
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','admin']));

-- Ingestion tokens are secrets represented only by hashes. Keep all client-side access
-- scoped to the organization and prevent arbitrary organization assignment.
drop policy if exists funnel_ingestion_tokens_owner_insert on public.funnel_ingestion_tokens;
drop policy if exists funnel_ingestion_tokens_owner_select on public.funnel_ingestion_tokens;
drop policy if exists funnel_ingestion_tokens_owner_update on public.funnel_ingestion_tokens;
drop policy if exists funnel_ingestion_tokens_owner_delete on public.funnel_ingestion_tokens;
create policy tenant_ingestion_token_select on public.funnel_ingestion_tokens
  for select to authenticated using (private.is_org_member(organization_id));
create policy tenant_ingestion_token_insert on public.funnel_ingestion_tokens
  for insert to authenticated
  with check (user_id = auth.uid()
    and private.has_org_role(organization_id, array['owner','admin','manager','operator'])
    and exists (select 1 from public.funnels f where f.id = funnel_id and f.organization_id = organization_id));
create policy tenant_ingestion_token_update on public.funnel_ingestion_tokens
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','admin','manager','operator']))
  with check (private.has_org_role(organization_id, array['owner','admin','manager','operator'])
    and exists (select 1 from public.funnels f where f.id = funnel_id and f.organization_id = organization_id));
create policy tenant_ingestion_token_delete on public.funnel_ingestion_tokens
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','admin']));

-- Tenant-scope legacy financial support tables so user_id cannot cross organizations.
alter table public.idempotency_keys add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.settlements add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.disputes add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.compliance_events add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.idempotency_keys k set organization_id=m.organization_id
from public.organization_members m where k.organization_id is null and k.user_id=m.user_id;
update public.settlements s set organization_id=m.organization_id
from public.organization_members m where s.organization_id is null and s.user_id=m.user_id;
update public.disputes d set organization_id=m.organization_id
from public.organization_members m where d.organization_id is null and d.user_id=m.user_id;
update public.compliance_events e set organization_id=m.organization_id
from public.organization_members m where e.organization_id is null and e.user_id=m.user_id;

alter table public.idempotency_keys alter column organization_id set not null;
alter table public.settlements alter column organization_id set not null;
alter table public.disputes alter column organization_id set not null;
alter table public.compliance_events alter column organization_id set not null;

create index if not exists idempotency_keys_org_expiry_idx on public.idempotency_keys(organization_id, expires_at);
create index if not exists settlements_org_time_idx on public.settlements(organization_id, created_at desc);
create index if not exists disputes_org_status_due_idx on public.disputes(organization_id, status, due_at);
create index if not exists compliance_events_org_time_idx on public.compliance_events(organization_id, created_at desc);

drop policy if exists idempotency_keys_owner_read on public.idempotency_keys;
drop policy if exists settlements_owner_read on public.settlements;
drop policy if exists disputes_owner_read on public.disputes;
drop policy if exists compliance_events_owner_read on public.compliance_events;
create policy idempotency_keys_tenant_read on public.idempotency_keys
  for select to authenticated using (private.is_org_member(organization_id));
create policy settlements_tenant_read on public.settlements
  for select to authenticated using (private.is_org_member(organization_id));
create policy disputes_tenant_read on public.disputes
  for select to authenticated using (private.is_org_member(organization_id));
create policy compliance_events_tenant_read on public.compliance_events
  for select to authenticated using (private.is_org_member(organization_id));

-- Organization membership mutation boundary: owners/admins may manage membership,
-- but no direct policy permits an operator/viewer to escalate privileges.
drop policy if exists org_members_insert_admin on public.organization_members;
drop policy if exists org_members_update_admin on public.organization_members;
drop policy if exists org_members_delete_admin on public.organization_members;
create policy org_members_insert_admin on public.organization_members
  for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','admin'])
    and role in ('owner','admin','manager','operator','supervisor','viewer'));
create policy org_members_update_admin on public.organization_members
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner','admin']))
  with check (private.has_org_role(organization_id, array['owner','admin'])
    and role in ('owner','admin','manager','operator','supervisor','viewer'));
create policy org_members_delete_admin on public.organization_members
  for delete to authenticated
  using (private.has_org_role(organization_id, array['owner','admin']) and user_id <> auth.uid());
