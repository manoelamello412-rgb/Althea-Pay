-- Security hardening: register_integration_event is no longer a direct RPC surface.
-- Event ingestion is performed through authenticated/internal application paths.
revoke execute on function public.register_integration_event(text, text, text, jsonb, timestamptz) from authenticated;
