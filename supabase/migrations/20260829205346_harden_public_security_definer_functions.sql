revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','manager','operator','supervisor','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security invoker set search_path = public
as $$ select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = auth.uid()); $$;

create or replace function public.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security invoker set search_path = public
as $$ select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = auth.uid() and m.role = any(allowed_roles)); $$;

create policy organizations_select_member on public.organizations for select to authenticated using (public.is_org_member(id));
create policy organizations_insert_authenticated on public.organizations for insert to authenticated with check (true);
create policy organizations_update_admin on public.organizations for update to authenticated using (public.has_org_role(id, array['owner','admin'])) with check (public.has_org_role(id, array['owner','admin']));
create policy organizations_delete_owner on public.organizations for delete to authenticated using (public.has_org_role(id, array['owner']));

create policy org_members_select_member on public.organization_members for select to authenticated using (public.is_org_member(organization_id));
create policy org_members_insert_admin on public.organization_members for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin']));
create policy org_members_update_admin on public.organization_members for update to authenticated using (public.has_org_role(organization_id, array['owner','admin'])) with check (public.has_org_role(organization_id, array['owner','admin']));
create policy org_members_delete_admin on public.organization_members for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']));

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();