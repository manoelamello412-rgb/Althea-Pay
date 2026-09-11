-- ALTHEA PAY — persist gender from authenticated signup metadata.
-- Backwards-compatible: existing profiles may remain NULL until completed.

alter table public.profiles
  add column if not exists gender text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_gender_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gender_check
      CHECK (gender IS NULL OR gender IN ('M', 'F', 'outro'));
  END IF;
END $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  requested_name text;
  base_slug text;
  final_slug text;
  requested_gender text;
begin
  requested_gender := nullif(new.raw_user_meta_data ->> 'gender', '');
  if requested_gender not in ('M', 'F', 'outro') then
    requested_gender := null;
  end if;

  insert into public.profiles (id, display_name, gender)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    ),
    requested_gender
  )
  on conflict (id) do update
    set display_name = coalesce(public.profiles.display_name, excluded.display_name),
        gender = coalesce(public.profiles.gender, excluded.gender);

  requested_name := coalesce(nullif(new.raw_user_meta_data ->> 'organization_name', ''), 'Minha operação');
  base_slug := regexp_replace(lower(requested_name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then
    base_slug := 'operacao';
  end if;
  final_slug := left(base_slug || '-' || substr(replace(new.id::text, '-', ''), 1, 8), 80);

  insert into public.organizations (name, slug)
  values (requested_name, final_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

-- Keep the existing auth trigger attached to the updated function.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
