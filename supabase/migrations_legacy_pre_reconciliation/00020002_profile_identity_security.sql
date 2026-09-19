-- ALTHEA PAY — profile identity/security surface
-- Keeps profile presentation data in public.profiles while sensitive business
-- identity remains in merchant_business_profiles/auth.users.

alter table public.profiles
  add column if not exists avatar_url text;

create index if not exists profiles_updated_at_idx
  on public.profiles (updated_at desc);
