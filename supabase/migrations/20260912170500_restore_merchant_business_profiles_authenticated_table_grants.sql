-- Restore the table privileges required by the authenticated Settings UI.
-- RLS remains the tenant boundary through user_id = auth.uid().
grant select, insert, update on table public.merchant_business_profiles to authenticated;
grant select, insert, update on table public.merchant_business_profiles to service_role;
