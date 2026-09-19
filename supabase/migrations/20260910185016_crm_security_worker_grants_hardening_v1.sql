revoke all on function public.crm_claim_channel_outbox(integer) from public, anon, authenticated;
grant execute on function public.crm_claim_channel_outbox_worker(integer) to service_role;
revoke all on function public.crm_claim_channel_outbox_worker(integer) from public, anon, authenticated;

-- The non-worker claim surface is retired. Keep the worker-only implementation authoritative.
drop function if exists public.crm_claim_channel_outbox(integer);