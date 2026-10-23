-- Delete buttons for funnels and clients (current organization only).
-- Funnels go to the bin (deleted_at): funnel-events and checkout-engine-v2 already ignore them, and their
-- configuration/history stays intact. Clients have no bin, so they are removed: identities, Kanban cards,
-- list memberships and call attempts cascade; conversations and tasks are kept unlinked.

create or replace function public.funnel_delete(p_funnel_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_name text;
begin
  if v_org is null or not private.has_org_capability(v_org, 'can_manage_funnels') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.funnels set deleted_at = now()
   where id = p_funnel_id and organization_id = v_org and deleted_at is null
  returning nome into v_name;
  if not found then raise exception 'FUNNEL_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'funnel.deleted', 'funnel', p_funnel_id, jsonb_build_object('name', v_name));
end;
$function$;

create or replace function public.client_delete(p_client_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid := private.current_organization_id();
  v_data jsonb;
begin
  if v_org is null or not private.has_org_role(v_org, array['owner', 'admin', 'manager']) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if exists (select 1 from public.subscriptions s where s.customer_id = p_client_id) then
    raise exception 'CLIENT_HAS_SUBSCRIPTIONS' using errcode = '23503';
  end if;
  delete from public.clients where id = p_client_id and organization_id = v_org returning data into v_data;
  if not found then raise exception 'CLIENT_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs(user_id, actor_id, organization_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), auth.uid(), v_org, 'client.deleted', 'client', p_client_id,
          jsonb_build_object('name', v_data->>'name', 'email', v_data->>'email'));
end;
$function$;

revoke all on function public.funnel_delete(text) from public, anon;
revoke all on function public.client_delete(text) from public, anon;
grant execute on function public.funnel_delete(text) to authenticated;
grant execute on function public.client_delete(text) to authenticated;
