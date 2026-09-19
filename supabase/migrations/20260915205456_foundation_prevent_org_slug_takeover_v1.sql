create or replace function public.create_organization_for_current_user(p_name text, p_slug text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name,''));
  v_slug text := lower(btrim(coalesce(p_slug,'')));
  v_org_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if v_name='' or length(v_name)>120 then raise exception 'INVALID_ORGANIZATION_NAME' using errcode='22023'; end if;
  if v_slug='' then v_slug:=trim(both '-' from regexp_replace(lower(v_name),'[^a-z0-9]+','-','g')); end if;
  if v_slug='' or length(v_slug)>80 or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_ORGANIZATION_SLUG' using errcode='22023'; end if;

  -- A caller may create a new organization, but can never attach to an
  -- existing organization merely by guessing its slug.
  select id into v_org_id from public.organizations where slug=v_slug limit 1;
  if v_org_id is not null then
    raise exception 'ORGANIZATION_SLUG_ALREADY_EXISTS' using errcode='23505';
  end if;

  insert into public.organizations(name,slug) values(v_name,v_slug) returning id into v_org_id;
  insert into public.organization_members(organization_id,user_id,role) values(v_org_id,v_user_id,'owner');
  update public.profiles set default_organization_id=v_org_id,updated_at=now() where id=v_user_id;
  insert into public.audit_logs(user_id,actor_id,action,resource_type,resource_id,metadata)
  values(v_user_id,v_user_id,'organization.created','organization',v_org_id::text,jsonb_build_object('source','self_service'));
  return v_org_id;
exception when unique_violation then
  raise exception 'ORGANIZATION_SLUG_ALREADY_EXISTS' using errcode='23505';
end;
$function$;