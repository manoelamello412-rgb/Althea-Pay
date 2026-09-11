CREATE OR REPLACE FUNCTION public.register_dynamic_gateway(
  p_provider_key text,p_display_name text,p_environment text,p_credentials jsonb,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,pg_catalog AS $$
DECLARE u uuid:=auth.uid(); r public.gateway_provider_registry%rowtype; c uuid; s uuid; ws uuid; gateway_id_text text; webhook_secret text; env text:=lower(trim(coalesce(p_environment,'production'))); clean_name text:=nullif(trim(p_display_name),'');
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 IF env NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'invalid_environment'; END IF;
 IF clean_name IS NULL OR length(clean_name)>120 THEN RAISE EXCEPTION 'invalid_display_name'; END IF;
 SELECT * INTO r FROM public.gateway_provider_registry WHERE provider_key=lower(trim(p_provider_key)) AND is_active=true LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_registered'; END IF;
 IF NOT public.validate_gateway_credential_schema(r.credential_schema,p_credentials) THEN RAISE EXCEPTION 'credential_schema_validation_failed'; END IF;
 s:=vault.create_secret(p_credentials::text,'gateway_credential_bundle:'||u::text||':'||r.provider_key||':'||replace(gen_random_uuid()::text,'-',''),'ALTHEA PAY dynamic gateway credential bundle: '||r.provider_key);
 INSERT INTO public.user_gateway_credentials(user_id,gateway_name,api_key_encrypted,secret_ref,metadata,is_active,priority_order,updated_at)
 VALUES(u,lower(r.provider_key)||':'||lower(regexp_replace(clean_name,'[^a-zA-Z0-9]+','_','g')),null,s::text,coalesce(p_metadata,'{}'::jsonb),true,1,timezone('utc',now()))
 ON CONFLICT(user_id,gateway_name) DO UPDATE SET api_key_encrypted=null,secret_ref=excluded.secret_ref,metadata=excluded.metadata,is_active=true,updated_at=timezone('utc',now()) RETURNING id INTO c;
 gateway_id_text:='gw_'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.gateways(id,user_id,provider,display_name,environment,status,capabilities,credential_id)
 VALUES(gateway_id_text,u,r.provider_key,clean_name,env,'inactive',coalesce(r.capabilities,'{}'::jsonb),c);
 webhook_secret:=nullif(trim(coalesce(p_credentials->>'webhook_secret','')),'');
 IF webhook_secret IS NOT NULL THEN
   ws:=vault.create_secret(webhook_secret,'gateway_webhook:'||u::text||':'||gateway_id_text,'ALTHEA PAY gateway webhook signing secret');
   INSERT INTO public.gateway_webhook_secrets(gateway_id,user_id,secret_ref,is_active,updated_at) VALUES(gateway_id_text,u,ws::text,true,timezone('utc',now())) ON CONFLICT(gateway_id) DO UPDATE SET user_id=excluded.user_id,secret_ref=excluded.secret_ref,is_active=true,updated_at=timezone('utc',now());
 END IF;
 RETURN jsonb_build_object('gateway_id',gateway_id_text,'credential_id',c,'provider_key',r.provider_key,'environment',env,'status','inactive','operational',r.operational,'adapter_key',r.adapter_key,'webhook_secret_configured',webhook_secret IS NOT NULL);
END; $$;
REVOKE ALL ON FUNCTION public.register_dynamic_gateway(text,text,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_dynamic_gateway(text,text,text,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_dynamic_gateway(p_gateway_id text,p_display_name text,p_environment text,p_credentials jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,pg_catalog AS $$
DECLARE u uuid:=auth.uid(); g public.gateways%rowtype; r public.gateway_provider_registry%rowtype; s uuid; ws uuid; env text:=lower(trim(coalesce(p_environment,'production'))); clean_name text:=nullif(trim(p_display_name),''); credentials_supplied boolean:=p_credentials IS NOT NULL AND jsonb_typeof(p_credentials)='object' AND p_credentials<>'{}'::jsonb; webhook_secret text;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 IF clean_name IS NULL OR length(clean_name)>120 THEN RAISE EXCEPTION 'invalid_display_name'; END IF;
 IF env NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'invalid_environment'; END IF;
 SELECT * INTO g FROM public.gateways WHERE id=p_gateway_id AND user_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'gateway_not_found'; END IF;
 SELECT * INTO r FROM public.gateway_provider_registry WHERE provider_key=g.provider AND is_active=true LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'provider_not_registered'; END IF;
 IF env<>g.environment AND NOT credentials_supplied THEN RAISE EXCEPTION 'credentials_required_for_environment_change'; END IF;
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
 UPDATE public.gateways SET display_name=clean_name,environment=env,status=CASE WHEN status='disabled' THEN 'inactive' ELSE status END WHERE id=p_gateway_id AND user_id=u;
 RETURN jsonb_build_object('gateway_id',p_gateway_id,'provider_key',g.provider,'environment',env,'display_name',clean_name,'credentials_updated',credentials_supplied);
END; $$;
REVOKE ALL ON FUNCTION public.update_dynamic_gateway(text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_dynamic_gateway(text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.disconnect_dynamic_gateway(p_gateway_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE u uuid:=auth.uid(); c uuid;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 SELECT credential_id INTO c FROM public.gateways WHERE id=p_gateway_id AND user_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'gateway_not_found'; END IF;
 UPDATE public.user_gateway_credentials SET is_active=false,updated_at=timezone('utc',now()) WHERE id=c AND user_id=u;
 UPDATE public.gateway_webhook_secrets SET is_active=false,updated_at=timezone('utc',now()) WHERE gateway_id=p_gateway_id AND user_id=u;
 UPDATE public.gateways SET status='disabled' WHERE id=p_gateway_id AND user_id=u;
 RETURN jsonb_build_object('gateway_id',p_gateway_id,'disconnected',true,'history_preserved',true);
END; $$;
REVOKE ALL ON FUNCTION public.disconnect_dynamic_gateway(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.disconnect_dynamic_gateway(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_gateway_credential_status(p_credential_id uuid,p_is_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_catalog AS $$
DECLARE u uuid:=auth.uid(); g public.gateways%rowtype;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
 SELECT * INTO g FROM public.gateways WHERE credential_id=p_credential_id AND user_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'credential_not_found'; END IF;
 IF coalesce(p_is_active,false) AND g.status NOT IN ('connected','degraded','disabled','error','inactive') THEN RAISE EXCEPTION 'gateway_not_eligible'; END IF;
 UPDATE public.user_gateway_credentials SET is_active=coalesce(p_is_active,false),updated_at=timezone('utc',now()) WHERE id=p_credential_id AND user_id=u;
 IF NOT FOUND THEN RAISE EXCEPTION 'credential_not_found'; END IF;
 IF coalesce(p_is_active,false) AND g.status='disabled' THEN UPDATE public.gateways SET status='inactive' WHERE id=g.id AND user_id=u; END IF;
 IF NOT coalesce(p_is_active,false) THEN UPDATE public.gateways SET status='disabled' WHERE id=g.id AND user_id=u; END IF;
 RETURN jsonb_build_object('id',p_credential_id,'is_active',coalesce(p_is_active,false));
END; $$;
REVOKE ALL ON FUNCTION public.set_gateway_credential_status(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_gateway_credential_status(uuid,boolean) TO authenticated;
