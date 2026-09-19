-- Althea Pay: authentication data model and tenant isolation
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Existing application tables get an explicit owner. Rows without an owner remain inaccessible
-- to normal authenticated users until the application assigns them to a user.
do $$
declare
  t text;
begin
  foreach t in array array['funnels','products','clients','sales','gateways','pix_configs','pix_history','chats','messages','logs'] loop
    execute format('alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete cascade', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Remove any existing policies with these names so this migration is repeatable.
drop policy if exists "owner_select" on public.funnels;
drop policy if exists "owner_insert" on public.funnels;
drop policy if exists "owner_update" on public.funnels;
drop policy if exists "owner_delete" on public.funnels;
drop policy if exists "owner_select" on public.products;
drop policy if exists "owner_insert" on public.products;
drop policy if exists "owner_update" on public.products;
drop policy if exists "owner_delete" on public.products;
drop policy if exists "owner_select" on public.clients;
drop policy if exists "owner_insert" on public.clients;
drop policy if exists "owner_update" on public.clients;
drop policy if exists "owner_delete" on public.clients;
drop policy if exists "owner_select" on public.sales;
drop policy if exists "owner_insert" on public.sales;
drop policy if exists "owner_update" on public.sales;
drop policy if exists "owner_delete" on public.sales;
drop policy if exists "owner_select" on public.gateways;
drop policy if exists "owner_insert" on public.gateways;
drop policy if exists "owner_update" on public.gateways;
drop policy if exists "owner_delete" on public.gateways;
drop policy if exists "owner_select" on public.pix_configs;
drop policy if exists "owner_insert" on public.pix_configs;
drop policy if exists "owner_update" on public.pix_configs;
drop policy if exists "owner_delete" on public.pix_configs;
drop policy if exists "owner_select" on public.pix_history;
drop policy if exists "owner_insert" on public.pix_history;
drop policy if exists "owner_update" on public.pix_history;
drop policy if exists "owner_delete" on public.pix_history;
drop policy if exists "owner_select" on public.chats;
drop policy if exists "owner_insert" on public.chats;
drop policy if exists "owner_update" on public.chats;
drop policy if exists "owner_delete" on public.chats;
drop policy if exists "owner_select" on public.messages;
drop policy if exists "owner_insert" on public.messages;
drop policy if exists "owner_update" on public.messages;
drop policy if exists "owner_delete" on public.messages;
drop policy if exists "owner_select" on public.logs;
drop policy if exists "owner_insert" on public.logs;
drop policy if exists "owner_update" on public.logs;
drop policy if exists "owner_delete" on public.logs;

do $$
declare
  t text;
begin
  foreach t in array array['funnels','products','clients','sales','gateways','pix_configs','pix_history','chats','messages','logs'] loop
    execute format('create policy "owner_select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner_insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner_update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner_delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Do not expose the automatic RLS helper to API callers.
revoke execute on function public.rls_auto_enable() from anon, authenticated;

-- Keep privileges explicit for the application roles.
grant select, insert, update on public.profiles to authenticated;
do $$
declare t text;
begin
  foreach t in array array['funnels','products','clients','sales','gateways','pix_configs','pix_history','chats','messages','logs'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;