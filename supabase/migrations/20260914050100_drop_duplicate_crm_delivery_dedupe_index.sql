-- ALTHEA PAY
-- Remove the duplicate CRM delivery-event deduplication index.
-- Keep the *_uidx index as the single canonical unique constraint surface.

DROP INDEX IF EXISTS public.crm_channel_delivery_events_dedupe_idx;
