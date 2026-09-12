-- ALTHEA PAY — Universal Gateway Connector
-- One extensible catalog entry for providers that do not yet have a native adapter.
-- This is infrastructure only: it does not create a connection, credentials, or mock transaction.

insert into public.gateway_provider_registry(
  provider_key,
  display_name,
  credential_schema,
  capabilities,
  is_custom_or_webhook_only,
  is_active,
  adapter_key,
  operational
)
values(
  'custom_rest',
  'Gateway personalizado / API REST',
  '{"fields":[
    {"name":"base_url","label":"URL base da API","type":"text","required":true},
    {"name":"api_key","label":"API Key / Token","type":"password","required":true},
    {"name":"auth_header","label":"Header de autenticação","type":"text","required":false},
    {"name":"auth_prefix","label":"Prefixo da autenticação","type":"text","required":false},
    {"name":"health_path","label":"Endpoint de saúde","type":"text","required":false},
    {"name":"create_path","label":"Endpoint de pagamento","type":"text","required":false},
    {"name":"status_path","label":"Endpoint de consulta","type":"text","required":false},
    {"name":"refund_path","label":"Endpoint de estorno","type":"text","required":false},
    {"name":"webhook_secret","label":"Segredo de webhook","type":"password","required":false}
  ]}',
  '{"payments":true,"refunds":true,"webhooks":true,"retrieveStatus":true}',
  true,
  true,
  null,
  false
)
on conflict (provider_key) do update set
  display_name=excluded.display_name,
  credential_schema=excluded.credential_schema,
  capabilities=excluded.capabilities,
  is_custom_or_webhook_only=excluded.is_custom_or_webhook_only,
  is_active=true,
  updated_at=now();

comment on table public.gateway_provider_registry is
  'Dynamic provider catalog. Native providers use provider-specific adapters; custom_rest is the universal extension entry and remains non-operational until an approved adapter/contract is configured.';
