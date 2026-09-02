alter table public.checkout_sessions add column if not exists idempotency_key text;

update public.checkout_sessions
set idempotency_key = nullif(metadata->>'idempotency_key', '')
where idempotency_key is null
  and metadata ? 'idempotency_key';

alter table public.checkout_sessions drop constraint if exists checkout_sessions_idempotency_key_length;
alter table public.checkout_sessions
  add constraint checkout_sessions_idempotency_key_length
  check (idempotency_key is null or (length(idempotency_key) between 1 and 300));

create unique index if not exists checkout_sessions_user_funnel_idempotency_uidx
  on public.checkout_sessions(user_id, funnel_id, idempotency_key)
  where idempotency_key is not null;
