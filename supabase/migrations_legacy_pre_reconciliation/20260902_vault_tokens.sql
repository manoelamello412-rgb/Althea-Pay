create table if not exists public.card_vault_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vault_token varchar(160) not null,
  fingerprint varchar(64) not null,
  card_brand varchar(32) not null,
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  network_tokens jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, vault_token),
  unique(user_id, fingerprint)
);

alter table public.card_vault_tokens enable row level security;

create policy card_vault_tokens_select on public.card_vault_tokens for select to authenticated using (user_id = auth.uid());

grant select on public.card_vault_tokens to authenticated;
revoke insert, update, delete on public.card_vault_tokens from authenticated;

create index if not exists idx_card_vault_tokens_user_fingerprint on public.card_vault_tokens(user_id, fingerprint);
