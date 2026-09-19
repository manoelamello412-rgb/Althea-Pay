alter table public.checkout_sessions add column if not exists recovery_status text default 'not_started';
alter table public.checkout_sessions add column if not exists recovery_last_sent_at timestamptz;
alter table public.checkout_sessions add column if not exists recovery_next_at timestamptz;
create index if not exists idx_checkout_recovery_queue on public.checkout_sessions (recovery_status, recovery_next_at) where status = 'abandoned';