-- ALTHEA PAY — Universal Custom REST Adapter activation
-- The adapter is now implemented inside gateway-provider-adapter.
update public.gateway_provider_registry
set operational = true,
    adapter_key = 'gateway-provider-adapter',
    updated_at = now()
where provider_key = 'custom_rest'
  and is_active = true;
