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