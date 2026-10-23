-- Members created by an owner/admin (POST /api/members, service role) carry app_metadata.althea_member_org/role.
-- app_metadata is only writable with the service role, so self-signups can never join an org this way.
-- Those users join that org instead of getting their own personal workspace.
create or replace function private.enforce_organization_member_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_role text;
  member_count integer;
begin
  if auth.uid() is null then
    -- Trusted backends (GoTrue signup/admin createUser, service_role, migrations) carry no JWT and never run as
    -- anon/authenticated; they already validated the caller. API requests without a user stay blocked.
    if coalesce(current_setting('role', true), 'none') not in ('anon','authenticated') then
      return new;
    end if;
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  select om.role into actor_role
  from public.organization_members om
  where om.organization_id = coalesce(new.organization_id, old.organization_id)
    and om.user_id = auth.uid()
  limit 1;

  if tg_op = 'INSERT' then
    if new.organization_id is null or new.user_id is null then
      raise exception 'INVALID_MEMBER' using errcode='23514';
    end if;
    if actor_role is null then
      select count(*) into member_count from public.organization_members om where om.organization_id = new.organization_id;
      if member_count = 0 and new.user_id = auth.uid() and new.role = 'owner' then
        return new;
      end if;
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
    if actor_role not in ('owner','admin') then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
    if actor_role = 'admin' and new.role = 'owner' then
      raise exception 'FORBIDDEN_OWNER_ASSIGNMENT' using errcode='42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if actor_role is null then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
    if old.organization_id <> new.organization_id then
      raise exception 'ORGANIZATION_IMMUTABLE' using errcode='42501';
    end if;
    if old.user_id = auth.uid() then
      raise exception 'SELF_ROLE_CHANGE_FORBIDDEN' using errcode='42501';
    end if;
    if old.role = 'owner' and actor_role <> 'owner' then
      raise exception 'FORBIDDEN_OWNER_MODIFICATION' using errcode='42501';
    end if;
    if actor_role = 'admin' and new.role = 'owner' then
      raise exception 'FORBIDDEN_OWNER_ASSIGNMENT' using errcode='42501';
    end if;
    if actor_role not in ('owner','admin') then
      raise exception 'FORBIDDEN' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.bootstrap_user_tenant() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org_id uuid; v_name text; v_slug text; v_role text;
begin
 v_name:=left(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,'workspace'),'@',1),'Workspace'),120);
 if new.raw_app_meta_data ? 'althea_member_org' then
  v_org_id:=(new.raw_app_meta_data->>'althea_member_org')::uuid;
  v_role:=new.raw_app_meta_data->>'althea_member_role';
  if v_role is null or v_role not in('admin','manager','operator','supervisor','viewer') then raise exception 'INVALID_MEMBER_ROLE' using errcode='22023'; end if;
  if not exists(select 1 from public.organizations where id=v_org_id) then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.organization_members(organization_id,user_id,role) values(v_org_id,new.id,v_role);
 else
  v_slug:='workspace-'||substr(md5(new.id::text),1,16);
  insert into public.organizations(name,slug) values(v_name,v_slug) on conflict(slug) do update set name=excluded.name returning id into v_org_id;
  insert into public.organization_members(organization_id,user_id,role) values(v_org_id,new.id,'owner') on conflict(organization_id,user_id) do update set role='owner';
 end if;
 insert into public.profiles(id,full_name,display_name,gender,default_organization_id) values(new.id,new.raw_user_meta_data->>'full_name',coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name'),case when new.raw_user_meta_data->>'gender' in('M','F','outro') then new.raw_user_meta_data->>'gender' else null end,v_org_id) on conflict(id) do update set default_organization_id=coalesce(public.profiles.default_organization_id,excluded.default_organization_id);
 return new; end; $$;

revoke all on function public.bootstrap_user_tenant() from public,authenticated,anon; grant execute on function public.bootstrap_user_tenant() to postgres;

-- GoTrue admin createUser inserts the user first and writes app_metadata in a follow-up UPDATE (same transaction),
-- so bootstrap_user_tenant above already gave them a personal workspace. Move them into the target org and drop
-- that still-empty workspace.
create or replace function private.join_member_org_from_app_metadata() returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_org_id uuid := (new.raw_app_meta_data->>'althea_member_org')::uuid; v_role text := new.raw_app_meta_data->>'althea_member_role';
begin
 if v_role is null or v_role not in('admin','manager','operator','supervisor','viewer') then raise exception 'INVALID_MEMBER_ROLE' using errcode='22023'; end if;
 if not exists(select 1 from public.organizations where id=v_org_id) then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
 insert into public.organization_members(organization_id,user_id,role) values(v_org_id,new.id,v_role) on conflict(organization_id,user_id) do nothing;
 update public.profiles set default_organization_id=v_org_id,updated_at=now() where id=new.id;
 delete from public.organizations o where o.slug='workspace-'||substr(md5(new.id::text),1,16) and o.id<>v_org_id
   and not exists(select 1 from public.organization_members m where m.organization_id=o.id and m.user_id<>new.id);
 return new; end; $$;

revoke all on function private.join_member_org_from_app_metadata() from public,authenticated,anon;

drop trigger if exists on_auth_user_member_org on auth.users;
create trigger on_auth_user_member_org after update of raw_app_meta_data on auth.users for each row
 when (new.raw_app_meta_data ? 'althea_member_org' and not coalesce(old.raw_app_meta_data ? 'althea_member_org', false))
 execute function private.join_member_org_from_app_metadata();
