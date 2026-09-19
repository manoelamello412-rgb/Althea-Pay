create unique index if not exists idempotency_keys_user_scope_key_uq
  on public.idempotency_keys(user_id, scope, idempotency_key);

create index if not exists idempotency_keys_status_created_idx
  on public.idempotency_keys(status, created_at);
