insert into public.gateway_provider_registry (provider_key,display_name,credential_schema,capabilities,operational,is_custom_or_webhook_only,is_active,adapter_key,adapter_url)
values (
  'afiliaxpay',
  'AfiliaxPay (PIX)',
  jsonb_build_object('fields',jsonb_build_array(
    jsonb_build_object('name','token','label','Token (ci_...)','type','password','required',true),
    jsonb_build_object('name','secret','label','Secret (cs_...)','type','password','required',true),
    jsonb_build_object('name','webhook_secret','label','Token do postback (gere um valor aleatório longo)','type','password','required',true)
  )),
  jsonb_build_object('create_payment',true,'payment_status',true,'retrieve_payment',true,'refund',false,'health_check',true,'webhook',true,'payment_methods',jsonb_build_array('pix')),
  true,false,true,'afiliaxpay',null
)
on conflict (provider_key) do update set display_name=excluded.display_name,credential_schema=excluded.credential_schema,capabilities=excluded.capabilities,operational=excluded.operational,is_custom_or_webhook_only=excluded.is_custom_or_webhook_only,is_active=excluded.is_active,adapter_key=excluded.adapter_key,adapter_url=excluded.adapter_url,updated_at=now();
