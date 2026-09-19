UPDATE public.gateway_provider_registry
SET operational = true,
    is_active = true,
    adapter_key = 'adyen',
    updated_at = now()
WHERE lower(provider_key) = 'adyen';
