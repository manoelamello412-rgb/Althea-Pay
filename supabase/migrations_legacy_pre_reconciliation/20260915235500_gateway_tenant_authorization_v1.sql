-- Stage 5: Universal Gateway tenant-aware management authorization
create or replace function public.update_dynamic_gateway(p_gateway_id text,p_display_name text,p_environment text,p_credentials jsonb default null) returns jsonb language plpgsql security definer set search_path to 'public','vault','pg_catalog' as $function$
declare u uuid:=auth.uid(); g public.gateways%rowtype; r public.gateway_provider_registry%rowtype; s uuid; ws uuid; env text:=lower(trim(coalesce(p_environment,'production'))); clean_name text:=nullif(trim(p_display_name),''); credentials_supplied boolean:=p_credentials is not null and jsonb_typeof(p_credentials)='object' and p_credentials<>'{}'::jsonb; webhook_secret text; environment_changed boolean;
begin
 if u is null then raise exception 'unauthorized' using errcode='42501'; end if;
 if clean_name is null or length(clean_name)>120 then raise exception 'invalid_display_name'; end if;
 if env not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
 select * into g from public.gateways where id=p_gateway_id for update;
 if not found or g.organization_id is null or not private.is_org_member(g.organization_id) then raise exception 'gateway_not_found' using errcode='42501'; end if;
 if not private.has_org_role(g.organization_id,array['owner','admin','manager']) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into r from public.gateway_provider_registry where provider_key=g.provider and is_active=true limit 1;
 if not found then raise exception 'provider_not_registered'; end if;
 environment_changed:=env<>g.environment;
 if environment_changed and not credentials_supplied then raise exception 'credentials_required_for_environment_change'; end if;
 if credentials_supplied then
   if not public.validate_gateway_credential_schema(r.credential_schema,p_credentials) then raise exception 'credential_schema_validation_failed'; end if;
   s:=vault.create_secret(p_credentials::text,'gateway_credential_bundle:'||u::text||':'||r.provider_key||':'||replace(gen_random_uuid()::text,'-',''),'ALTHEA PAY dynamic gateway credential bundle: '||r.provider_key);
   update public.user_gateway_credentials set api_key_encrypted=null,secret_ref=s::text,is_active=true,updated_at=timezone('utc',now()) where id=g.credential_id;
   if not found then raise exception 'credential_not_found'; end if;
   webhook_secret:=nullif(trim(coalesce(p_credentials->>'webhook_secret','')),'');
   if webhook_secret is not null then
     update public.gateway_webhook_secrets set is_active=false,updated_at=timezone('utc',now()) where gateway_id=p_gateway_id;
     ws:=vault.create_secret(webhook_secret,'gateway_webhook:'||u::text||':'||p_gateway_id||':'||replace(gen_random_uuid()::text,'-',''),'ALTHEA PAY gateway webhook signing secret');
     insert into public.gateway_webhook_secrets(gateway_id,user_id,secret_ref,is_active,updated_at) values(p_gateway_id,u,ws::text,true,timezone('utc',now())) on conflict(gateway_id) do update set user_id=excluded.user_id,secret_ref=excluded.secret_ref,is_active=true,updated_at=timezone('utc',now());
   end if;
 end if;
 update public.gateways set display_name=clean_name,environment=env,status=case when credentials_supplied or environment_changed then 'inactive' when status='disabled' then 'inactive' else status end where id=p_gateway_id;
 return jsonb_build_object('gateway_id',p_gateway_id,'provider_key',g.provider,'environment',env,'display_name',clean_name,'credentials_updated',credentials_supplied,'organization_id',g.organization_id);
end;$function$;

create or replace function public.disconnect_dynamic_gateway(p_gateway_id text) returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $function$
declare u uuid:=auth.uid(); c uuid; v_org_id uuid;
begin
 if u is null then raise exception 'unauthorized' using errcode='42501'; end if;
 select g.credential_id,g.organization_id into c,v_org_id from public.gateways g where g.id=p_gateway_id for update;
 if c is null or v_org_id is null or not private.is_org_member(v_org_id) then raise exception 'gateway_not_found' using errcode='42501'; end if;
 if not private.has_org_role(v_org_id,array['owner','admin','manager']) then raise exception 'forbidden' using errcode='42501'; end if;
 update public.user_gateway_credentials set is_active=false,updated_at=timezone('utc',now()) where id=c;
 update public.gateway_webhook_secrets set is_active=false,updated_at=timezone('utc',now()) where gateway_id=p_gateway_id;
 update public.gateways set status='disabled' where id=p_gateway_id;
 return jsonb_build_object('gateway_id',p_gateway_id,'disconnected',true,'history_preserved',true);
end;$function$;

create or replace function public.set_gateway_credential_status(p_credential_id uuid,p_is_active boolean) returns jsonb language plpgsql security definer set search_path to 'public','extensions','pg_catalog' as $function$
declare u uuid:=auth.uid(); g public.gateways%rowtype;
begin
 if u is null then raise exception 'unauthorized' using errcode='42501'; end if;
 select * into g from public.gateways where credential_id=p_credential_id for update;
 if not found or g.organization_id is null or not private.is_org_member(g.organization_id) then raise exception 'credential_not_found' using errcode='42501'; end if;
 if not private.has_org_role(g.organization_id,array['owner','admin','manager','operator']) then raise exception 'forbidden' using errcode='42501'; end if;
 if coalesce(p_is_active,false) and g.status not in ('connected','degraded','disabled','error','inactive') then raise exception 'gateway_not_eligible'; end if;
 update public.user_gateway_credentials set is_active=coalesce(p_is_active,false),updated_at=timezone('utc',now()) where id=p_credential_id;
 if not found then raise exception 'credential_not_found'; end if;
 if coalesce(p_is_active,false) and g.status='disabled' then update public.gateways set status='inactive' where id=g.id; end if;
 if not coalesce(p_is_active,false) then update public.gateways set status='disabled' where id=g.id; end if;
 return jsonb_build_object('id',p_credential_id,'is_active',coalesce(p_is_active,false));
end;$function$;

create or replace function public.get_gateway_panel_metrics(p_gateway_id text) returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $function$
declare u uuid:=auth.uid(); g public.gateways%rowtype; op_total bigint; wh_total bigint; tx_total bigint; mismatch_total bigint; last_test text; last_latency bigint;
begin
 if u is null then raise exception 'unauthorized' using errcode='42501'; end if;
 select * into g from public.gateways where id=p_gateway_id;
 if not found or g.organization_id is null or not private.is_org_member(g.organization_id) then raise exception 'gateway_not_found' using errcode='42501'; end if;
 select count(*) into op_total from public.gateway_operation_logs where gateway_id=p_gateway_id;
 select count(*) into wh_total from public.gateway_webhook_events where gateway_id=p_gateway_id;
 select count(*) into tx_total from public.gateway_transactions where gateway_id=p_gateway_id;
 select count(*) into mismatch_total from public.reconciliation_runs rr where rr.gateway_id=p_gateway_id and rr.mismatch_count>0;
 last_test:=case when jsonb_typeof(coalesce(g.data,'{}'::jsonb))='object' then g.data->>'last_connection_test_at' else null end;
 last_latency:=case when jsonb_typeof(coalesce(g.data,'{}'::jsonb))='object' and (g.data->>'last_connection_latency_ms')~'^[0-9]+$' then (g.data->>'last_connection_latency_ms')::bigint else null end;
 return jsonb_build_object('gateway_id',g.id,'status',g.status,'environment',g.environment,'last_connection_test_at',last_test,'last_connection_latency_ms',last_latency,'operations_total',op_total,'webhook_events_total',wh_total,'transactions_total',tx_total,'reconciliation_runs_with_mismatch',mismatch_total);
end;$function$;

revoke execute on function public.update_dynamic_gateway(text,text,text,jsonb) from anon;
grant execute on function public.update_dynamic_gateway(text,text,text,jsonb) to authenticated;
revoke execute on function public.disconnect_dynamic_gateway(text) from anon;
grant execute on function public.disconnect_dynamic_gateway(text) to authenticated;
revoke execute on function public.set_gateway_credential_status(uuid,boolean) from anon;
grant execute on function public.set_gateway_credential_status(uuid,boolean) to authenticated;
revoke execute on function public.get_gateway_panel_metrics(text) from anon;
grant execute on function public.get_gateway_panel_metrics(text) to authenticated;
