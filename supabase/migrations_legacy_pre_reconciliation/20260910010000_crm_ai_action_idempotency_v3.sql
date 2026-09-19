alter table public.crm_ai_actions add column if not exists idempotency_key text;
create unique index if not exists crm_ai_actions_idempotency_uidx on public.crm_ai_actions(user_id,idempotency_key) where idempotency_key is not null;
create index if not exists crm_ai_actions_conversation_created_idx on public.crm_ai_actions(conversation_id,created_at desc);
revoke all on public.crm_ai_actions from anon;
