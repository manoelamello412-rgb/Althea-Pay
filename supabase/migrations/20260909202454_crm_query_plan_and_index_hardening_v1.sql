begin;

alter policy crm_agents_owner_select on public.crm_agents using (user_id=(select auth.uid()));
alter policy crm_webhook_events_select on public.crm_webhook_events using (user_id=(select auth.uid()));

create index if not exists crm_ai_actions_conversation_idx on public.crm_ai_actions(conversation_id,created_at desc);
create index if not exists crm_notes_author_idx on public.crm_conversation_notes(author_id,created_at desc);
create index if not exists crm_notes_conversation_created_idx on public.crm_conversation_notes(conversation_id,created_at desc);

-- Remove only exact duplicate CRM indexes; the canonical idx_* names remain.
drop index if exists public.crm_conversations_user_updated_idx;
drop index if exists public.idx_crm_conversations_public_token;
drop index if exists public.crm_messages_conversation_created_idx;

commit;