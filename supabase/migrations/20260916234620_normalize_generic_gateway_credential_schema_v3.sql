update public.gateway_provider_registry
set credential_schema = jsonb_build_object('fields', jsonb_build_array(
  jsonb_build_object('name','base_url','type','text','label','URL base da API','required',true),
  jsonb_build_object('name','api_key','type','password','label','API Key / Token','required',false),
  jsonb_build_object('name','access_token','type','password','label','Access Token','required',false),
  jsonb_build_object('name','secret_key','type','password','label','Secret Key','required',false),
  jsonb_build_object('name','webhook_secret','type','password','label','Webhook Secret','required',false),
  jsonb_build_object('name','auth_header','type','text','label','Header de autenticação','required',false),
  jsonb_build_object('name','auth_prefix','type','text','label','Prefixo de autenticação','required',false),
  jsonb_build_object('name','health_path','type','text','label','Endpoint de saúde','required',false),
  jsonb_build_object('name','create_path','type','text','label','Endpoint de criação de pagamento','required',false),
  jsonb_build_object('name','status_path','type','text','label','Endpoint de consulta de pagamento','required',false),
  jsonb_build_object('name','refund_path','type','text','label','Endpoint de reembolso','required',false),
  jsonb_build_object('name','request_template','type','text','label','Template JSON da requisição','required',false),
  jsonb_build_object('name','response_mapping','type','text','label','Mapeamento JSON da resposta','required',false),
  jsonb_build_object('name','status_mapping','type','text','label','Mapeamento de status','required',false),
  jsonb_build_object('name','custom_headers','type','text','label','Headers adicionais JSON','required',false),
  jsonb_build_object('name','idempotency_header','type','text','label','Header de idempotência','required',false),
  jsonb_build_object('name','create_method','type','text','label','Método de criação','required',false),
  jsonb_build_object('name','status_method','type','text','label','Método de consulta','required',false),
  jsonb_build_object('name','refund_method','type','text','label','Método de reembolso','required',false),
  jsonb_build_object('name','health_method','type','text','label','Método de saúde','required',false)
)),
adapter_key = 'generic_http_json',
adapter_contract_version = 2,
operational = true,
is_active = true
where provider_key = 'generic_http';

update public.gateway_provider_registry
set is_active = false, operational = false
where provider_key = 'custom_rest';