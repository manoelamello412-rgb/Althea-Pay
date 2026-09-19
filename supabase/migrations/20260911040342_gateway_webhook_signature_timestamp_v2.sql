begin;
-- Align stored signature_timestamp with the provider's signed timestamp where one exists.
-- The Edge Function runtime is responsible for extracting it and falls back to receive time for providers without a signed timestamp.
commit;