create or replace function public.organization_my_access_v1(p_organization_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_caps jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  v_org := p_organization_id;

  if v_org is null then
    select p.default_organization_id
      into v_org
    from public.profiles p
    where p.id=v_uid;
  end if;

  select om.role
    into v_role
  from public.organization_members om
  where om.organization_id=v_org
    and om.user_id=v_uid;

  if v_role is null then
    raise exception 'ORGANIZATION_ACCESS_DENIED' using errcode='42501';
  end if;

  select jsonb_object_agg(capability, private.has_org_capability(v_org, capability))
    into v_caps
  from (values
    ('can_view_chats'),
    ('can_reply_chats'),
    ('can_view_values'),
    ('can_manage_gateways'),
    ('can_change_funnel_gateway'),
    ('can_view_customers'),
    ('can_manage_members'),
    ('can_view_audit'),
    ('can_manage_funnels'),
    ('can_manage_products'),
    ('can_manage_automations'),
    ('can_manage_integrations')
  ) as x(capability);

  return jsonb_build_object(
    'organization_id', v_org,
    'user_id', v_uid,
    'role', v_role,
    'capabilities', coalesce(v_caps,'{}'::jsonb),
    'operational_history_hours', private.org_operational_history_hours(v_org),
    'retention_policy', 'separate_from_visibility'
  );
end;
$function$;

revoke all on function public.organization_my_access_v1(uuid) from public, anon;
grant execute on function public.organization_my_access_v1(uuid) to authenticated;
