-- ALTHEA PAY foundation: canonical organization/tenant bootstrap.
-- No provider-specific integration is introduced here.

create or replace function public.create_organization_for_current_user(p_name text, p_slug text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_org_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'INVALID_ORGANIZATION_NAME' using errcode = '22023'; end if;
  if v_slug = '' then
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  end if;
  if v_slug = '' or length(v_slug) > 80 or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'INVALID_ORGANIZATION_SLUG' using errcode = '22023';
  end if;

  insert into public.organizations(name, slug) values (v_name, v_slug) returning id into v_org_id;
  insert into public.organization_members(organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner';
  update public.profiles set default_organization_id = v_org_id, updated_at = now() where id = v_user_id;
  insert into public.audit_logs(user_id, actor_id, action, resource_type, resource_id, metadata)
  values (v_user_id, v_user_id, 'organization.created', 'organization', v_org_id::text, jsonb_build_object('source','self_service'));
  return v_org_id;
exception when unique_violation then
  raise exception 'ORGANIZATION_SLUG_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

create or replace function public.bootstrap_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_name text;
  v_slug text;
begin
  v_name := left(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, 'workspace'), '@', 1), 'Workspace'), 120);
  v_slug := 'workspace-' || substr(md5(new.id::text), 1, 16);
  insert into public.organizations(name, slug) values (v_name, v_slug)
  on conflict (slug) do update set name = excluded.name returning id into v_org_id;
  insert into public.organization_members(organization_id, user_id, role)
  values (v_org_id, new.id, 'owner')
  on conflict (organization_id, user_id) do update set role = 'owner';
  insert into public.profiles(id, full_name, display_name, gender, default_organization_id)
  values (new.id, new.raw_user_meta_data->>'full_name', coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name'), case when new.raw_user_meta_data->>'gender' in ('M','F','outro') then new.raw_user_meta_data->>'gender' else null end, v_org_id)
  on conflict (id) do update set default_organization_id = coalesce(public.profiles.default_organization_id, excluded.default_organization_id);
  return new;
end;
$$;

revoke all on function public.create_organization_for_current_user(text,text) from public;
grant execute on function public.create_organization_for_current_user(text,text) to authenticated;
revoke all on function public.bootstrap_user_tenant() from public, authenticated, anon;
grant execute on function public.bootstrap_user_tenant() to postgres;

alter table public.profiles add column if not exists default_organization_id uuid references public.organizations(id) on delete set null;
create index if not exists profiles_default_organization_idx on public.profiles(default_organization_id);
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check check (role in ('owner','admin','manager','operator','supervisor','viewer'));
drop policy if exists organizations_insert_authenticated on public.organizations;
drop trigger if exists on_auth_user_tenant_bootstrap on auth.users;
create trigger on_auth_user_tenant_bootstrap after insert on auth.users for each row execute function public.bootstrap_user_tenant();

do $$
declare r record; v_org uuid;
begin
  for r in select u.id, u.email, u.raw_user_meta_data from auth.users u where not exists (select 1 from public.organization_members m where m.user_id = u.id) loop
    insert into public.organizations(name, slug)
    values (left(coalesce(r.raw_user_meta_data->>'display_name', r.raw_user_meta_data->>'full_name', split_part(coalesce(r.email, 'workspace'), '@', 1), 'Workspace'), 120), 'workspace-' || substr(md5(r.id::text), 1, 16))
    on conflict (slug) do update set name = excluded.name returning id into v_org;
    insert into public.organization_members(organization_id, user_id, role) values (v_org, r.id, 'owner') on conflict (organization_id, user_id) do update set role='owner';
    insert into public.profiles(id, full_name, display_name, default_organization_id)
    values (r.id, r.raw_user_meta_data->>'full_name', r.raw_user_meta_data->>'display_name', v_org)
    on conflict (id) do update set default_organization_id = coalesce(public.profiles.default_organization_id, excluded.default_organization_id);
  end loop;
end $$;

update public.profiles p
set default_organization_id = (select om.organization_id from public.organization_members om where om.user_id=p.id order by om.created_at, om.organization_id limit 1), updated_at=now()
where p.default_organization_id is null and exists (select 1 from public.organization_members om where om.user_id=p.id);
