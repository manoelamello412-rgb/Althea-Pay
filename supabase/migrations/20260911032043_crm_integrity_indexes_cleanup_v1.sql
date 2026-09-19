begin;
create index if not exists crm_team_members_agent_id_idx on public.crm_team_members(agent_id);
drop index if exists public.idx_crm_conversations_user_updated;
drop index if exists public.idx_crm_messages_conversation_created;
drop index if exists public.uq_crm_messages_user_client_message;
drop index if exists public.idx_crm_webhook_events_user_received;
commit;