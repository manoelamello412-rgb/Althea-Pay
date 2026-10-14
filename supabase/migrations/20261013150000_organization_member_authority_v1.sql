-- Server-side organization authority for Edge Functions.
-- Edge Functions run as service_role, so private.has_org_capability (bound to auth.uid()) cannot answer for
-- the calling user. The capability rule now lives in private.member_has_org_capability and both the RLS
-- helper and the new service RPC delegate to it, so there is a single source of truth.

create or replace function private.member_has_org_capability(target_org uuid, target_user uuid, requested_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_role text;
  v_override boolean;
begin
  if target_user is null or target_org is null or requested_capability is null then
    return false;
  end if;

  select om.role into v_role
    from public.organization_members om
   where om.organization_id = target_org
     and om.user_id = target_user
   limit 1;

  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;

  select c.allowed into v_override
    from public.organization_member_capabilities c
   where c.organization_id = target_org
     and c.user_id = target_user
     and c.capability = requested_capability;

  if found then return v_override; end if;

  return private.role_has_org_capability(v_role, requested_capability);
end;
$function$;
revoke all on function private.member_has_org_capability(uuid,uuid,text) from public, anon, authenticated;

create or replace function private.has_org_capability(target_org uuid, requested_capability text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  select private.member_has_org_capability(target_org, auth.uid(), requested_capability);
$function$;

-- Resolves the caller's organization (explicit, or their default), role, the organization owner (the
-- operation-owner user_id that workers still key on) and the requested capabilities in one round trip.
create or replace function public.organization_member_authority_v1(
  p_user_id uuid,
  p_organization_id uuid default null,
  p_capabilities text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_role text;
  v_owner uuid;
  v_capabilities jsonb := '{}'::jsonb;
  v_capability text;
begin
  if p_user_id is null then return null; end if;

  v_org := coalesce(p_organization_id, (select p.default_organization_id from public.profiles p where p.id = p_user_id));
  select om.role into v_role
    from public.organization_members om
   where om.organization_id = v_org and om.user_id = p_user_id
   limit 1;
  if v_role is null then return null; end if;

  select om.user_id into v_owner
    from public.organization_members om
   where om.organization_id = v_org and om.role = 'owner'
   order by om.created_at asc, om.user_id
   limit 1;

  foreach v_capability in array coalesce(p_capabilities, '{}'::text[]) loop
    v_capabilities := v_capabilities
      || jsonb_build_object(v_capability, private.member_has_org_capability(v_org, p_user_id, v_capability));
  end loop;

  return jsonb_build_object(
    'organization_id', v_org,
    'role', v_role,
    'owner_user_id', v_owner,
    'capabilities', v_capabilities
  );
end;
$function$;
revoke all on function public.organization_member_authority_v1(uuid,uuid,text[]) from public, anon, authenticated;
grant execute on function public.organization_member_authority_v1(uuid,uuid,text[]) to service_role;
