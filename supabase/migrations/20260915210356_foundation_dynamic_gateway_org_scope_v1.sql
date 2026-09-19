create or replace function public.register_dynamic_gateway(p_provider_key text, p_display_name text, p_environment text, p_credentials jsonb, p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, vault, pg_catalog
as $function$
declare
 u uuid:=auth.uid(); v_org_id uuid; r public.gateway_provider_registry%rowtype; c uuid; s uuid; ws uuid; gateway_id_text text; webhook_secret text; env text:=lower(trim(coalesce(p_environment,'production'))); clean_name text:=nullif(trim(p_display_name),'');
begin
 if u is null then raise exception 'unauthorized' using errcode='42501'; end if;
 select default_organization_id into v_org_id from public.profiles where id=u;
 if v_org_id is null or not private.is_org_member(v_org_id) then raise exception 'organization_required' using errcode='42501'; end if;
 if not private.has_org_role(v_org_id,array['owner','admin','manager','operator']) then raise exception 'forbidden' using errcode='42501'; end if;
 if env not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
 if clean_name is null or length(clean_name)>120 then raise exception 'invalid_display_name'; end if;
 select * into r from public.gateway_provider_registry where provider_key=lower(trim(p_provider_key)) and is_active=true limit 1;
 if not found then raise exception 'provider_not_registered'; end if;
 if not public.validate_gateway_credential_schema(r.credential_schema,p_credentials) then raise exception 'credential_schema_validation_failed'; end if;
 s:=vault.create_secret(p_credentials::text,'gateway_credential_bundle:'||u::text||':'||r.provider_key||':'||replace(gen_random_uuid()::text,'-',''),'ALTHEA PAY dynamic gateway credential bundle: '||r.provider_key);
 insert into public.user_gateway_credentials(user_id,gateway_name,api_key_encrypted,secret_ref,metadata,is_active,priority_order,updated_at)
 values(u,lower(r.provider_key)||':'||lower(regexp_replace(clean_name,'[^a-zA-Z0-9]+','_','g')),null,s::text,coalesce(p_metadata,'{}'::jsonb),true,1,timezone('utc',now()))
 on conflict(user_id,gateway_name) do update set api_key_encrypted=null,secret_ref=excluded.secret_ref,metadata=excluded.metadata,is_active=true,updated_at=timezone('utc',now()) returning id into c;
 gateway_id_text:='gw_'||replace(gen_random_uuid()::text,'-','');
 insert into public.gateways(id,user_id,organization_id,provider,display_name,environment,status,capabilities,credential_id)
 values(gateway_id_text,u,v_org_id,r.provider_key,clean_name,env,'inactive',coalesce(r.capabilities,'{}'::jsonb),c);
 webhook_secret:=nullif(trim(coalesce(p_credentials->>'webhook_secret','')),'');
 if webhook_secret is not null then
   ws:=vault.create_secret(webhook_secret,'gateway_webhook:'||u::text||':'||gateway_id_text,'ALTHEA PAY gateway webhook signing secret');
   insert into public.gateway_webhook_secrets(gateway_id,user_id,secret_ref,is_active,updated_at) values(gateway_id_text,u,ws::text,true,timezone('utc',now()))
   on conflict(gateway_id) do update set user_id=excluded.user_id,secret_ref=excluded.secret_ref,is_active=true,updated_at=timezone('utc',now());
 end if;
 return jsonb_build_object('gateway_id',gateway_id_text,'credential_id',c,'provider_key',r.provider_key,'environment',env,'status','inactive','operational',r.operational,'adapter_key',r.adapter_key,'webhook_secret_configured',webhook_secret is not null,'organization_id',v_org_id);
end;
$function$;