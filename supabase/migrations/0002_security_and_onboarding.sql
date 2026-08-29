-- ALTHEA CORE 0002
-- Role-aware write policies + automatic first-organization onboarding.
-- Secrets and gateway credentials must remain outside public tables/browser storage.

create or replace function public.current_member_role(target_org uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = target_org
    and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.has_org_role(target_org uuid, allowed_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  requested_name text;
  base_slug text;
  final_slug text;
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'user'), '@', 1))
  )
  on conflict (id) do nothing;

  requested_name := coalesce(nullif(new.raw_user_meta_data ->> 'organization_name', ''), 'Minha operação');
  base_slug := regexp_replace(lower(requested_name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then
    base_slug := 'operacao';
  end if;
  final_slug := left(base_slug || '-' || substr(replace(new.id::text, '-', ''), 1, 8), 80);

  insert into public.organizations (name, slug)
  values (requested_name, final_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

-- Runs after Supabase Auth creates a user. The trigger is idempotent for profiles.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Organization administration.
create policy organizations_owner_update
on public.organizations
for update to authenticated
using (public.has_org_role(id, array['owner','admin']::public.member_role[]))
with check (public.has_org_role(id, array['owner','admin']::public.member_role[]));

create policy organizations_owner_delete
on public.organizations
for delete to authenticated
using (public.has_org_role(id, array['owner']::public.member_role[]));

-- Profiles: users can maintain their own profile.
create policy profile_self_insert
on public.profiles
for insert to authenticated
with check (id = auth.uid());

create policy profile_self_update
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Members: owners/admins can manage membership; members can read their organization.
create policy member_admin_insert
on public.organization_members
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy member_admin_update
on public.organization_members
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy member_admin_delete
on public.organization_members
for delete to authenticated
using (public.has_org_role(organization_id, array['owner']::public.member_role[]));

-- Funnel/product management.
create policy funnels_manager_insert
on public.funnels
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy funnels_manager_update
on public.funnels
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy funnels_manager_delete
on public.funnels
for delete to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy products_manager_insert
on public.products
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy products_manager_update
on public.products
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy products_manager_delete
on public.products
for delete to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy funnel_products_manager_insert
on public.funnel_products
for insert to authenticated
with check (exists (
  select 1 from public.funnels f
  where f.id = funnel_id
    and public.has_org_role(f.organization_id, array['owner','admin','manager']::public.member_role[])
));

create policy funnel_products_manager_delete
on public.funnel_products
for delete to authenticated
using (exists (
  select 1 from public.funnels f
  where f.id = funnel_id
    and public.has_org_role(f.organization_id, array['owner','admin','manager']::public.member_role[])
));

-- Gateway connections: credentials are referenced by secret_ref and must be stored in server-side secrets.
create policy gateways_manager_insert
on public.gateway_connections
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy gateways_manager_update
on public.gateway_connections
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create policy gateways_manager_delete
on public.gateway_connections
for delete to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy funnel_gateways_manager_insert
on public.funnel_gateway_connections
for insert to authenticated
with check (exists (
  select 1 from public.funnels f
  where f.id = funnel_id
    and public.has_org_role(f.organization_id, array['owner','admin','manager']::public.member_role[])
));

create policy funnel_gateways_manager_update
on public.funnel_gateway_connections
for update to authenticated
using (exists (
  select 1 from public.funnels f
  where f.id = funnel_id
    and public.has_org_role(f.organization_id, array['owner','admin','manager']::public.member_role[])
))
with check (exists (
  select 1 from public.funnels f
  where f.id = funnel_id
    and public.has_org_role(f.organization_id, array['owner','admin','manager']::public.member_role[])
));

create policy funnel_gateways_manager_delete
on public.funnel_gateway_connections
for delete to authenticated
using (exists (
  select 1 from public.funnels f
  where f.id = funnel_id
    and public.has_org_role(f.organization_id, array['owner','admin','manager']::public.member_role[])
));

-- Customer/lead/chat writes are available to operational roles, while sale/event ingestion remains server-side.
create policy customers_operator_insert
on public.customers
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]));

create policy customers_operator_update
on public.customers
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]));

create policy leads_operator_insert
on public.leads
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]));

create policy leads_operator_update
on public.leads
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]));

create policy chats_operator_insert
on public.chat_conversations
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]));

create policy chats_operator_update
on public.chat_conversations
for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[]));

create policy messages_operator_insert
on public.chat_messages
for insert to authenticated
with check (
  sender_type in ('operator','system')
  and (
    sender_type = 'system'
    or sender_user_id = auth.uid()
  )
  and exists (
    select 1
    from public.chat_conversations c
    where c.id = conversation_id
      and public.has_org_role(c.organization_id, array['owner','admin','manager','operator','supervisor']::public.member_role[])
  )
);

-- Sales and integration_events are intentionally not client-writable.
-- They will be ingested through trusted server-side connectors/webhooks after provider signature validation.
