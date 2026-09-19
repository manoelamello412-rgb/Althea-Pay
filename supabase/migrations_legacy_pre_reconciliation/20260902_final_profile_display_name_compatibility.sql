alter table public.profiles add column if not exists display_name text;

update public.profiles
set display_name = full_name
where display_name is null;

create or replace function public.sync_profile_display_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.display_name is null or btrim(new.display_name) = '' then
    new.display_name := new.full_name;
  end if;
  if new.full_name is null or btrim(new.full_name) = '' then
    new.full_name := new.display_name;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_sync_display_name on public.profiles;
create trigger profiles_sync_display_name
before insert or update on public.profiles
for each row execute function public.sync_profile_display_name();

revoke all on function public.sync_profile_display_name() from public, anon, authenticated;
