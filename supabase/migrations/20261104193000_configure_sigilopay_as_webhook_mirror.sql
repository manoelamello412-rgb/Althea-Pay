begin;

-- SigiloPay is an inbound event mirror, not a payment-creation adapter.
-- Keep operational=false so it cannot be selected as a payment-processing
-- adapter, but expose it in the gateway connector as webhook-only.
update public.gateway_provider_registry
set
  display_name = 'SigiloPay',
  operational = false,
  is_custom_or_webhook_only = true,
  credential_schema = jsonb_build_object(
    'fields',
    jsonb_build_array(
      jsonb_build_object(
        'name', 'webhook_secret',
        'type', 'password',
        'label', 'Token de autenticação do webhook SigiloPay',
        'required', true
      )
    )
  ),
  updated_at = timezone('utc', now())
where provider_key = 'sigilopay';

commit;
