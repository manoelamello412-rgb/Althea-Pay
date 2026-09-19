update public.gateway_provider_registry
set credential_schema = jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('name','public_key','type','text','label','Public Key','required',false),
    jsonb_build_object('name','access_token','type','password','label','Access Token','required',false),
    jsonb_build_object('name','client_id','type','text','label','Client ID','required',false),
    jsonb_build_object('name','client_secret','type','password','label','Client Secret','required',false),
    jsonb_build_object('name','base_url','type','text','label','URL base da API (avançado)','required',true),
    jsonb_build_object('name','webhook_secret','type','password','label','Webhook Secret (avançado)','required',false),
    jsonb_build_object('name','auth_header','type','text','label','Header de autenticação (avançado)','required',false),
    jsonb_build_object('name','auth_prefix','type','text','label','Prefixo de autenticação (avançado)','required',false),
    jsonb_build_object('name','health_path','type','text','label','Endpoint de saúde (avançado)','required',false),
    jsonb_build_object('name','create_path','type','text','label','Endpoint de criação de pagamento (avançado)','required',false),
    jsonb_build_object('name','status_path','type','text','label','Endpoint de consulta de pagamento (avançado)','required',false),
    jsonb_build_object('name','refund_path','type','text','label','Endpoint de reembolso (avançado)','required',false),
    jsonb_build_object('name','request_template','type','text','label','Template JSON da requisição (avançado)','required',false),
    jsonb_build_object('name','response_mapping','type','text','label','Mapeamento JSON da resposta (avançado)','required',false),
    jsonb_build_object('name','status_mapping','type','text','label','Mapeamento de status (avançado)','required',false),
    jsonb_build_object('name','custom_headers','type','text','label','Headers adicionais JSON (avançado)','required',false),
    jsonb_build_object('name','idempotency_header','type','text','label','Header de idempotência (avançado)','required',false),
    jsonb_build_object('name','create_method','type','text','label','Método de criação (avançado)','required',false),
    jsonb_build_object('name','status_method','type','text','label','Método de consulta (avançado)','required',false),
    jsonb_build_object('name','refund_method','type','text','label','Método de reembolso (avançado)','required',false),
    jsonb_build_object('name','health_method','type','text','label','Método de saúde (avançado)','required',false)
  )
)
where provider_key = 'generic_http';