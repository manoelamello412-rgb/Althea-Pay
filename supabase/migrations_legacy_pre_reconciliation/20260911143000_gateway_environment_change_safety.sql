CREATE OR REPLACE FUNCTION public.update_dynamic_gateway(p_gateway_id text,p_display_name text,p_environment text,p_credentials jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,pg_catalog AS $$
DECLARE
  u uuid:=auth.uid();
  g public.gateways%rowtype;
  r public.gateway_provider_registry%rowtype;
  s uuid;
  ws uuid;
  env text:=lower(trim(coalesce(p_environment,'production')));
  clean_name text:=nullif(trim(p_display_name),'');
  credentials_supplied boolean:=p_credentials IS NOT NULL AND jsonb_typeof(p_credentials)='object' AND p_credentials<>'{}'::jsonb;
  environment_changed boolean;
  webhook_secret text;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF clean_name IS NULL OR length(clean_name)>120 THEN RAISE EXCEPTION 'invalid_display_name'; END IF;
  IF env NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'invalid_environment'; END IF;
  SELECT * INTO g FROM public.gateways WHERE id=p_gateway_id AND user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gateway_not_found'; END IF;
  SELECT * INTO r FROM public.gateway_provider_registry WHERE provider_key=g.provider AND is_active=true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_registered'; END IF;
  environment_changed:=env<>g.environment;
  IF environment_changed AND NOT credentials_supplied THEN RAISE EXCEPTION 'credentials_required_for_environment_change'; END IF;
  IF credentials_supplied THEN
    IF NOT public.validate_gateway_credential_schema(r.credential_schema,p_credentials) THEN RAISE EXCEPTION 'credential_schema_validation_failed'; END IF;
    s:=vault.create_secret(p_credentials::text,'gateway_credential_bundle:'||u::text||':'||r.provider_key||':'||replace(gen_random_uuid()::text,'-',''),'ALTHEA PAY dynamic gateway credential bundle: '||r.provider_key);
    UPDATE public.user_gateway_credentials SET api_key_encrypted=null,secret_ref=s::text,is_active=true,updated_at=timezone('utc',now()) WHERE id=g.credential_id AND user_id=u;
    IF NOT FOUND THEN RAISE EXCEPTION 'credential_not_found'; END IF;
    webhook_secret:=nullif(trim(coalesce(p_credentials->>'webhook_secret','')),'');
    IF webhook_secret IS NOT NULL THEN
      UPDATE public.gateway_webhook_secrets SET is_active=false,updated_at=timezone('utc',now()) WHERE gateway_id=p_gateway_id AND user_id=u;
      ws:=vault.create_secret(webhook_secret,'gateway_webhook:'||u::text||':'||p_gateway_id||':'||replace(gen_random_uuid()::text,'-',''),'ALTHEA PAY gateway webhook signing secret');
      INSERT INTO public.gateway_webhook_secrets(gateway_id,user_id,secret_ref,is_active,updated_at) VALUES(p_gateway_id,u,ws::text,true,timezone('utc',now())) ON CONFLICT(gateway_id) DO UPDATE SET user_id=excluded.user_id,secret_ref=excluded.secret_ref,is_active=true,updated_at=timezone('utc',now());
    END IF;
  END IF;
  UPDATE public.gateways SET display_name=clean_name,environment=env,status=CASE WHEN credentials_supplied OR environment_changed THEN 'inactive' WHEN status='disabled' THEN 'inactive' ELSE status END WHERE id=p_gateway_id AND user_id=u;
  RETURN jsonb_build_object('gateway_id',p_gateway_id,'provider_key',g.provider,'environment',env,'display_name',clean_name,'credentials_updated',credentials_supplied);
END; $$;
REVOKE ALL ON FUNCTION public.update_dynamic_gateway(text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_dynamic_gateway(text,text,text,jsonb) TO authenticated;
