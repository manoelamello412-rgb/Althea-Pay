begin;

alter table public.checkout_sessions
  add column if not exists organization_id uuid;

update public.checkout_sessions cs
set organization_id = om.organization_id
from public.organization_members om
where cs.organization_id is null
  and om.user_id = cs.user_id;

create index if not exists checkout_sessions_organization_created_idx
  on public.checkout_sessions (organization_id, created_at desc);

create index if not exists checkout_sessions_organization_user_created_idx
  on public.checkout_sessions (organization_id, user_id, created_at desc);

create or replace function private.set_checkout_session_organization()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  resolved_org uuid;
begin
  if new.organization_id is not null then
    return new;
  end if;

  if new.funnel_id is not null then
    select f.organization_id
      into resolved_org
      from public.funnels f
     where f.id = new.funnel_id
     limit 1;
  end if;

  if resolved_org is null then
    select p.default_organization_id
      into resolved_org
      from public.profiles p
     where p.id = new.user_id
     limit 1;
  end if;

  if resolved_org is null then
    select om.organization_id
      into resolved_org
      from public.organization_members om
     where om.user_id = new.user_id
     order by om.created_at asc
     limit 1;
  end if;

  if resolved_org is null then
    raise exception using errcode = '23514', message = 'checkout_session_organization_required';
  end if;

  new.organization_id := resolved_org;
  return new;
end;
$$;

revoke all on function private.set_checkout_session_organization() from public, anon, authenticated;

drop trigger if exists trg_checkout_sessions_set_organization on public.checkout_sessions;
create trigger trg_checkout_sessions_set_organization
before insert on public.checkout_sessions
for each row
execute function private.set_checkout_session_organization();

alter table public.checkout_sessions
  alter column organization_id set not null;

alter table public.checkout_sessions
  add constraint checkout_sessions_organization_fk
  foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.checkout_sessions enable row level security;

drop policy if exists checkout_sessions_owner on public.checkout_sessions;
drop policy if exists checkout_sessions_org_select on public.checkout_sessions;

create policy checkout_sessions_org_select
on public.checkout_sessions
for select
to authenticated
using ((select private.is_org_member(organization_id)));

revoke all on table public.checkout_sessions from anon;
revoke insert, update, delete, truncate, references, trigger on table public.checkout_sessions from authenticated;
grant select on table public.checkout_sessions to authenticated;

commit;
