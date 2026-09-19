begin;
create or replace function public.provision_funnel_atomic(p_name text,p_url text,p_connection_type text,p_funnel_type text,p_event_endpoint text)
returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare v_user_id uuid:=auth.uid(); v_org_id uuid; v_funnel_id text; v_token text; v_funnel jsonb; v_connection jsonb; v_token_row jsonb;
begin
 if v_user_id is null then raise exception using errcode='42501',message='unauthorized'; end if;
 select default_organization_id into v_org_id from public.profiles where id=v_user_id;
 if v_org_id is null or not private.is_org_member(v_org_id) then raise exception using errcode='42501',message='organization_required'; end if;
 if not private.has_org_role(v_org_id,array['owner','admin','manager','operator']) then raise exception using errcode='42501',message='forbidden'; end if;
 if p_name is null or btrim(p_name)='' then raise exception using errcode='22023',message='name is required'; end if;
 if length(p_name)>120 then raise exception using errcode='22023',message='name is too long'; end if;
 if p_connection_type not in('script','webhook') then raise exception using errcode='22023',message='invalid connection_type'; end if;
 if p_funnel_type not in('sales','lead_capture','launch','product','upsell_downsell','subscription','custom') then raise exception using errcode='22023',message='invalid funnel_type'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_org_id::text||':funnel-provision',0));
 v_funnel_id:='funnel_'||regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','-','g'); v_funnel_id:=regexp_replace(v_funnel_id,'^-+|-+$','','g'); v_funnel_id:=left(v_funnel_id,48); if v_funnel_id='funnel_' or v_funnel_id='' then v_funnel_id:='funnel_funnel'; end if; v_funnel_id:=left(v_funnel_id||'_'||replace(gen_random_uuid()::text,'-',''),100);
 v_token:='alt_fnl_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.funnels(id,nome,url,endpoint,status,funnel_type,user_id,organization_id) values(v_funnel_id,btrim(p_name),nullif(btrim(p_url),''),p_event_endpoint,'active',p_funnel_type,v_user_id,v_org_id) returning jsonb_build_object('id',id,'nome',nome,'url',url,'endpoint',endpoint,'status',status,'funnel_type',funnel_type,'organization_id',organization_id,'created_at',created_at) into v_funnel;
 insert into public.funnel_connections(user_id,funnel_id,organization_id,connection_type,status,health_status,config,connected_at) values(v_user_id,v_funnel_id,v_org_id,p_connection_type,'active','unknown',jsonb_build_object('protocol_version','2026-09','event_endpoint',p_event_endpoint,'funnel_type',p_funnel_type),now()) returning jsonb_build_object('id',id,'funnel_id',funnel_id,'connection_type',connection_type,'status',status,'health_status',health_status,'connected_at',connected_at) into v_connection;
 insert into public.funnel_ingestion_tokens(user_id,funnel_id,organization_id,token_prefix,token_hash,enabled) values(v_user_id,v_funnel_id,v_org_id,left(v_token,14),encode(extensions.digest(v_token,'sha256'),'hex'),true) returning jsonb_build_object('id',id,'funnel_id',funnel_id,'token_prefix',token_prefix,'enabled',enabled,'created_at',created_at) into v_token_row;
 perform public.seed_funnel_structure(v_funnel_id);
 return jsonb_build_object('funnel',v_funnel,'connection',v_connection,'ingestion',v_token_row||jsonb_build_object('token',v_token,'event_endpoint',p_event_endpoint),'warning','Store the ingestion token securely. It is returned only during provisioning.');
end; $$;
revoke all on function public.provision_funnel_atomic(text,text,text,text,text) from public,anon;
grant execute on function public.provision_funnel_atomic(text,text,text,text,text) to authenticated;
commit;
