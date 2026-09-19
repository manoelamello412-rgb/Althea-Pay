BEGIN;
create table if not exists public.platform_api_credentials (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 key_prefix text not null,
 key_hash text not null,
 vault_secret_id uuid,
 is_active boolean not null default true,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 last_revealed_at timestamptz,
 unique(user_id)
);
alter table public.platform_api_credentials enable row level security;
drop policy if exists platform_api_credentials_select_own on public.platform_api_credentials;
create policy platform_api_credentials_select_own on public.platform_api_credentials for select to authenticated using(auth.uid()=user_id);
create index if not exists idx_platform_api_credentials_user on public.platform_api_credentials(user_id);
COMMIT;