begin;

-- Products: one canonical tenant policy set. Direct table writes remain constrained; application mutations use the SECURITY DEFINER RPCs.
drop policy if exists products_delete_tenant on public.products;
drop policy if exists products_insert_tenant on public.products;
drop policy if exists products_select_tenant on public.products;
drop policy if exists products_update_tenant on public.products;
drop policy if exists tenant_delete on public.products;
drop policy if exists tenant_insert on public.products;
drop policy if exists tenant_select on public.products;
drop policy if exists tenant_update on public.products;
create policy products_select_tenant on public.products for select to authenticated using (private.is_org_member(organization_id));
create policy products_insert_tenant on public.products for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']));
create policy products_update_tenant on public.products for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor'])) with check (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']));
create policy products_delete_tenant on public.products for delete to authenticated using (private.has_org_role(organization_id, array['owner','admin']));

-- Funnel offers are the product-to-funnel association surface. Bring it under the same organization boundary.
alter table public.funnel_offers add column if not exists organization_id uuid;
update public.funnel_offers fo set organization_id = f.organization_id from public.funnels f where f.id = fo.funnel_id and fo.organization_id is null;
alter table public.funnel_offers alter column organization_id set not null;
create index if not exists funnel_offers_organization_id_idx on public.funnel_offers(organization_id);
create index if not exists funnel_offers_product_id_idx on public.funnel_offers(product_id);

drop policy if exists funnel_offers_owner_delete on public.funnel_offers;
drop policy if exists funnel_offers_owner_insert on public.funnel_offers;
drop policy if exists funnel_offers_owner_select on public.funnel_offers;
drop policy if exists funnel_offers_owner_update on public.funnel_offers;
create policy funnel_offers_tenant_select on public.funnel_offers for select to authenticated using (private.is_org_member(organization_id));
create policy funnel_offers_tenant_insert on public.funnel_offers for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']));
create policy funnel_offers_tenant_update on public.funnel_offers for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor'])) with check (private.has_org_role(organization_id, array['owner','admin','manager','operator','supervisor']));
create policy funnel_offers_tenant_delete on public.funnel_offers for delete to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager']));

commit;