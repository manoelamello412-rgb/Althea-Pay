
INSERT INTO public.gateway_provider_registry (
  provider_key,
  display_name,
  adapter_key,
  credential_schema,
  capabilities,
  operational,
  is_active,
  is_custom_or_webhook_only
)
VALUES (
  'sigilopay',
  'SigiloPay',
  'sigilopay',
  '{
    "fields": [
      {
        "name": "client_id",
        "label": "Chave pública SigiloPay",
        "type": "text",
        "required": true
      },
      {
        "name": "client_secret",
        "label": "Chave secreta SigiloPay",
        "type": "password",
        "required": true
      },
      {
        "name": "webhook_secret",
        "label": "Segredo do webhook",
        "type": "password",
        "required": false
      }
    ]
  }'::jsonb,
  '{
    "health_check": true,
    "create_payment": false,
    "payment_status": false,
    "retrieve_payment": false,
    "refund": false,
    "webhook": false
  }'::jsonb,
  false,
  true,
  false
)
ON CONFLICT (provider_key) DO NOTHING;
