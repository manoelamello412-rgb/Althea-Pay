UPDATE public.gateway_provider_registry
SET operational = false,
    is_active = true,
    updated_at = now()
WHERE lower(provider_key) = 'adyen';
