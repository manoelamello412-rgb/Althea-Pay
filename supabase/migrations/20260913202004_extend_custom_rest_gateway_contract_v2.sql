update public.gateway_provider_registry
set credential_schema = jsonb_build_object(
  'version', 2,
  'fields', jsonb_build_array(
    jsonb_build_object('key','base_url','label','Base URL','type','text','required',true),
    jsonb_build_object('key','api_key','label','API Key','type','password','required',true),
    jsonb_build_object('key','auth_header','label','Auth Header','type','text','required',false),
    jsonb_build_object('key','auth_prefix','label','Auth Prefix','type','text','required',false),
    jsonb_build_object('key','health_path','label','Health Path','type','text','required',false),
    jsonb_build_object('key','health_method','label','Health Method','type','text','required',false),
    jsonb_build_object('key','create_path','label','Create Payment Path','type','text','required',false),
    jsonb_build_object('key','create_method','label','Create Payment Method','type','text','required',false),
    jsonb_build_object('key','status_path','label','Status Path','type','text','required',false),
    jsonb_build_object('key','status_method','label','Status Method','type','text','required',false),
    jsonb_build_object('key','refund_path','label','Refund Path','type','text','required',false),
    jsonb_build_object('key','refund_method','label','Refund Method','type','text','required',false),
    jsonb_build_object('key','idempotency_header','label','Idempotency Header','type','text','required',false),
    jsonb_build_object('key','request_template','label','Request Template JSON','type','text','required',false),
    jsonb_build_object('key','response_mapping','label','Response Mapping JSON','type','text','required',false),
    jsonb_build_object('key','status_mapping','label','Status Mapping JSON','type','text','required',false),
    jsonb_build_object('key','webhook_secret','label','Webhook Secret','type','password','required',false)
  )
), adapter_contract_version = 2, operational = true, is_custom_or_webhook_only = true, updated_at = now()
where provider_key = 'custom_rest';