-- ALTHEA PAY — persist gender from authenticated signup metadata.
-- Backwards-compatible: existing profiles may remain NULL until completed.

alter table public.profiles add column if not exists gender text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
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
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, full_name, display_name, gender)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    case
      when new.raw_user_meta_data->>'gender' in ('M', 'F', 'outro') then new.raw_user_meta_data->>'gender'
      else null
    end
  )
  on conflict (id) do update
    set full_name = coalesce(public.profiles.full_name, excluded.full_name),
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        gender = coalesce(public.profiles.gender, excluded.gender);
  return new;
end;
$$;
