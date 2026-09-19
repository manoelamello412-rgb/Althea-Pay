drop policy if exists products_select_tenant on public.products;
create policy products_select_tenant on public.products for select to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=products.organization_id and m.user_id=auth.uid()));
