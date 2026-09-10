-- Multi-CRM security hardening: retire the user-callable outbox claim surface.
-- The authoritative channel outbox worker is service_role-only.

revoke all on function public.crm_claim_channel_outbox(integer) from public, anon, authenticated;

grant execute on function public.crm_claim_channel_outbox_worker(integer) to service_role;
revoke all on function public.crm_claim_channel_outbox_worker(integer) from public, anon, authenticated;

drop function if exists public.crm_claim_channel_outbox(integer);
