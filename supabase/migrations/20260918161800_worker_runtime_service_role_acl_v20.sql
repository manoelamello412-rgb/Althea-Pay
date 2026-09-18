-- Restore only the direct table privileges required by trusted scheduled Edge workers.
-- These grants are service-role only; no anon/authenticated browser privileges are added.

grant select, update on table public.gateway_webhook_events to service_role;

grant select, update on table public.automation_executions to service_role;

grant select on table public.crm_agents to service_role;
grant select, insert on table public.iara_commercial_interventions to service_role;
grant insert on table public.crm_channel_message_outbox to service_role;

grant select, insert, update on table public.iara_daily_reports to service_role;
