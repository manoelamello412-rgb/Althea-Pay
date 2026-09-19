create table if not exists public.brand_identity_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  logo_url text not null default '/althea-mark.svg',
  ink text not null default '#0B0B0D',
  forest text not null default '#0F1A16',
  deep text not null default '#0D362D',
  green text not null default '#1DB854',
  gold text not null default '#D4AF37',
  silver text not null default '#A6A6A6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_identity_settings enable row level security;
alter table public.brand_identity_settings force row level security;

drop policy if exists "brand_identity_select_own" on public.brand_identity_settings;
create policy "brand_identity_select_own" on public.brand_identity_settings for select to authenticated using (auth.uid() = user_id);

drop policy if exists "brand_identity_insert_own" on public.brand_identity_settings;
create policy "brand_identity_insert_own" on public.brand_identity_settings for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "brand_identity_update_own" on public.brand_identity_settings;
create policy "brand_identity_update_own" on public.brand_identity_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "brand_identity_delete_own" on public.brand_identity_settings;
create policy "brand_identity_delete_own" on public.brand_identity_settings for delete to authenticated using (auth.uid() = user_id);

create index if not exists brand_identity_settings_updated_at_idx on public.brand_identity_settings(updated_at desc);

create or replace function public.set_brand_identity_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_brand_identity_updated_at on public.brand_identity_settings;
create trigger trg_brand_identity_updated_at before update on public.brand_identity_settings for each row execute function public.set_brand_identity_updated_at();