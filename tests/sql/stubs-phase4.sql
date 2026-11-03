create table public.platform_settings(user_id uuid primary key, data jsonb not null default '{}', updated_at timestamptz default now());
create function private.organization_owner_id(uuid) returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
