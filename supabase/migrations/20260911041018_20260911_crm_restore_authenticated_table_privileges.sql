begin;

-- Restore PostgREST table privileges for the canonical Multi-CRM tables.
-- RLS remains the authorization boundary; these grants only restore the SQL privileges
-- required for authenticated clients to reach the existing RLS policies.
grant select, insert, update, delete on table public.crm_conversations to authenticated;
grant select, insert, update, delete on table public.crm_messages to authenticated;
grant select, insert, update, delete on table public.crm_webhook_events to authenticated;
grant select on table public.crm_agents to authenticated;
grant select, insert, update, delete on table public.crm_channel_accounts to authenticated;

commit;