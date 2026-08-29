-- ALTHEA SECURITY + AUTOMATION LAYER
-- Role-aware writes, updated_at automation, and audit-ready helpers.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_organizations_updated_at before update on public.organizations for each row execute function public.touch_updated_at();
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger trg_funnels_updated_at before update on public.funnels for each row execute function public.touch_updated_at();
create trigger trg_products_updated_at before update on public.products for each row execute function public.touch_updated_at();
create trigger trg_gateways_updated_at before update on public.gateway_connections for each row execute function public.touch_updated_at();
create trigger trg_customers_updated_at before update on public.customers for each row execute function public.touch_updated_at();
create trigger trg_leads_updated_at before update on public.leads for each row execute function public.touch_updated_at();
create trigger trg_sales_updated_at before update on public.sales for each row execute function public.touch_updated_at();
create trigger trg_chats_updated_at before update on public.chat_conversations for each row execute function public.touch_updated_at();

create or replace function public.has_org_role(target_org uuid, allowed_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

-- Operational writes: owners/admins/managers can manage configuration;
-- operators/supervisors can work with customer, lead, sale and chat records.
create policy funnels_manager_insert on public.funnels for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy funnels_manager_update on public.funnels for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy funnels_manager_delete on public.funnels for delete to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy products_manager_insert on public.products for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy products_manager_update on public.products for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy products_manager_delete on public.products for delete to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy gateways_manager_insert on public.gateway_connections for insert to authenticated
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy gateways_manager_update on public.gateway_connections for update to authenticated
using (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]))
with check (public.has_org_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy gateways_manager_delete on public.gateway_connections for delete to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::public.member_role[]));

create policy customers_operator_insert on public.customers for insert to authenticated
with check (public.is_org_member(organization_id));
create policy customers_operator_update on public.customers for update to authenticated
using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy leads_operator_insert on public.leads for insert to authenticated
with check (public.is_org_member(organization_id));
create policy leads_operator_update on public.leads for update to authenticated
using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy chats_operator_insert on public.chat_conversations for insert to authenticated
with check (public.is_org_member(organization_id));
create policy chats_operator_update on public.chat_conversations for update to authenticated
using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy messages_operator_insert on public.chat_messages for insert to authenticated
with check (exists (select 1 from public.chat_conversations c where c.id = conversation_id and public.is_org_member(c.organization_id)));

create policy sales_member_insert on public.sales for insert to authenticated
with check (public.is_org_member(organization_id));
create policy sales_member_update on public.sales for update to authenticated
using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- The integration_events table is intentionally write-protected from normal users.
-- External gateway events must enter through the signed webhook function.

-- Realtime is enabled for the live-chat surface. Final publication setup can be
-- adjusted in the Supabase dashboard/CLI after the project is linked.
