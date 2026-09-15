-- Foundation hardening: enforce referenced-funnel tenant equality and avoid per-row auth evaluation.

drop policy if exists tenant_ingestion_token_insert on public.funnel_ingestion_tokens;
create policy tenant_ingestion_token_insert on public.funnel_ingestion_tokens for insert to authenticated with check (
  (user_id = (select auth.uid()))
  and (select private.has_org_role(organization_id, array['owner','admin','manager','operator']))
  and exists (
    select 1 from public.funnels f
    where f.id = funnel_ingestion_tokens.funnel_id
      and f.organization_id = funnel_ingestion_tokens.organization_id
  )
);

drop policy if exists tenant_ingestion_token_update on public.funnel_ingestion_tokens;
create policy tenant_ingestion_token_update on public.funnel_ingestion_tokens for update to authenticated using (
  (select private.has_org_role(organization_id, array['owner','admin','manager','operator']))
) with check (
  (select private.has_org_role(organization_id, array['owner','admin','manager','operator']))
  and exists (
    select 1 from public.funnels f
    where f.id = funnel_ingestion_tokens.funnel_id
      and f.organization_id = funnel_ingestion_tokens.organization_id
  )
);

drop policy if exists tenant_insert on public.funnel_connections;
create policy tenant_insert on public.funnel_connections for insert to authenticated with check (
  (select private.has_org_role(organization_id, array['owner','admin','manager','operator']))
  and exists (
    select 1 from public.funnels f
    where f.id = funnel_connections.funnel_id
      and f.organization_id = funnel_connections.organization_id
  )
);

drop policy if exists tenant_update on public.funnel_connections;
create policy tenant_update on public.funnel_connections for update to authenticated using (
  (select private.has_org_role(organization_id, array['owner','admin','manager','operator']))
) with check (
  (select private.has_org_role(organization_id, array['owner','admin','manager','operator']))
  and exists (
    select 1 from public.funnels f
    where f.id = funnel_connections.funnel_id
      and f.organization_id = funnel_connections.organization_id
  )
);

drop policy if exists tenant_api_key_insert on public.api_keys;
create policy tenant_api_key_insert on public.api_keys for insert to authenticated with check (
  user_id = (select auth.uid())
  and (select private.has_org_role(organization_id, array['owner','admin','manager']))
);

drop policy if exists tenant_api_key_update on public.api_keys;
create policy tenant_api_key_update on public.api_keys for update to authenticated using (
  user_id = (select auth.uid())
  and (select private.has_org_role(organization_id, array['owner','admin','manager']))
) with check (
  user_id = (select auth.uid())
  and (select private.has_org_role(organization_id, array['owner','admin','manager']))
);

drop policy if exists org_members_delete_admin on public.organization_members;
create policy org_members_delete_admin on public.organization_members for delete to authenticated using (
  (select private.has_org_role(organization_id, array['owner','admin']))
  and user_id <> (select auth.uid())
);
