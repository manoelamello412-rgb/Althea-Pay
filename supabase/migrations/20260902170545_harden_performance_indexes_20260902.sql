drop index if exists public.idempotency_keys_user_scope_key_uq;
create index if not exists event_dead_letters_resolved_by_idx on public.event_dead_letters (resolved_by);