drop policy if exists org_members_insert_admin on public.organization_members;
create policy org_members_insert_admin on public.organization_members for insert to authenticated with check (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
  and role = any(ARRAY['owner','admin','manager','operator','supervisor','viewer'])
);

drop policy if exists org_members_update_admin on public.organization_members;
create policy org_members_update_admin on public.organization_members for update to authenticated using (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
) with check (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
  and role = any(ARRAY['owner','admin','manager','operator','supervisor','viewer'])
);

drop policy if exists tenant_api_key_delete on public.api_keys;
create policy tenant_api_key_delete on public.api_keys for delete to authenticated using (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
);

drop policy if exists tenant_delete on public.funnel_connections;
create policy tenant_delete on public.funnel_connections for delete to authenticated using (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
);

drop policy if exists tenant_ingestion_token_delete on public.funnel_ingestion_tokens;
create policy tenant_ingestion_token_delete on public.funnel_ingestion_tokens for delete to authenticated using (
  (select private.has_org_role(organization_id, ARRAY['owner','admin']))
);
