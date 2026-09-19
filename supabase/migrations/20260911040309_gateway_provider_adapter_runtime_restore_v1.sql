begin;
-- Keep the internal provider adapter as the execution primitive for normal checkout/recovery flows.
-- Public/browser access remains blocked by the Edge Function's internal-secret check; no provider is connected by this migration.
commit;