create or replace function public.provision_funnel_commercial_atomic(
  p_name text,
  p_url text,
  p_connection_type text,
  p_funnel_type text,
  p_event_endpoint text,
  p_product_id text,
  p_gateway_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_funnel_id text;
  v_token text;
  v_funnel jsonb;
  v_connection jsonb;
  v_token_row jsonb;
  v_product record;
  v_gateway record;
  v_offer jsonb;
  v_binding jsonb;
begin
  if v_user_id is null then raise exception using errcode='42501', message='unauthorized'; end if;
  select default_organization_id into v_org_id from public.profiles where id=v_user_id;
  if v_org_id is null or not private.is_org_member(v_org_id) then raise exception using errcode='42501', message='organization_required'; end if;
  if not private.has_org_role(v_org_id,array['owner','admin','manager','operator']) then raise exception using errcode='42501', message='forbidden'; end if;
  if p_name is null or btrim(p_name)='' then raise exception using errcode='22023', message='name is required'; end if;
  if length(p_name)>120 then raise exception using errcode='22023', message='name is too long'; end if;
  if p_connection_type not in('script','webhook') then raise exception using errcode='22023', message='invalid connection_type'; end if;
  if p_funnel_type not in('sales','lead_capture','launch','product','upsell_downsell','subscription','custom') then raise exception using errcode='22023', message='invalid funnel_type'; end if;
  if p_product_id is null or btrim(p_product_id)='' then raise exception using errcode='22023', message='product_required'; end if;
  if p_gateway_id is null or btrim(p_gateway_id)='' then raise exception using errcode='22023', message='gateway_required'; end if;

  select id,name,unit_amount,currency,status,organization_id,user_id into v_product
  from public.products where id=p_product_id and deleted_at is null for share;
  if not found then raise exception using errcode='22023', message='product_not_found'; end if;
  if v_product.organization_id <> v_org_id then raise exception using errcode='42501', message='product_organization_mismatch'; end if;
  if v_product.status <> 'active' then raise exception using errcode='22023', message='product_not_active'; end if;

  select id,display_name,provider,status,organization_id,user_id into v_gateway
  from public.gateways where id=p_gateway_id for share;
  if not found then raise exception using errcode='22023', message='gateway_not_found'; end if;
  if v_gateway.organization_id <> v_org_id then raise exception using errcode='42501', message='gateway_organization_mismatch'; end if;
  if lower(coalesce(v_gateway.status,'')) in ('disabled','inactive','disconnected') then raise exception using errcode='22023', message='gateway_not_operational'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org_id::text||':funnel-provision-commercial',0));
  v_funnel_id:='funnel_'||regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','-','g');
  v_funnel_id:=regexp_replace(v_funnel_id,'^-+|-+$','','g');
  v_funnel_id:=left(v_funnel_id,48);
  if v_funnel_id='funnel_' or v_funnel_id='' then v_funnel_id:='funnel_funnel'; end if;
  v_funnel_id:=left(v_funnel_id||'_'||replace(gen_random_uuid()::text,'-',''),100);
  v_token:='alt_fnl_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');

  insert into public.funnels(id,nome,url,endpoint,status,funnel_type,user_id,organization_id)
  values(v_funnel_id,btrim(p_name),nullif(btrim(p_url),''),p_event_endpoint,'active',p_funnel_type,v_user_id,v_org_id)
  returning jsonb_build_object('id',id,'nome',nome,'url',url,'endpoint',endpoint,'status',status,'funnel_type',funnel_type,'organization_id',organization_id,'created_at',created_at) into v_funnel;

  insert into public.funnel_connections(user_id,funnel_id,organization_id,connection_type,status,health_status,config,connected_at)
  values(v_user_id,v_funnel_id,v_org_id,p_connection_type,'active','unknown',jsonb_build_object('protocol_version','2026-09','event_endpoint',p_event_endpoint,'funnel_type',p_funnel_type),now())
  returning jsonb_build_object('id',id,'funnel_id',funnel_id,'connection_type',connection_type,'status',status,'health_status',health_status,'connected_at',connected_at) into v_connection;

  insert into public.funnel_ingestion_tokens(user_id,funnel_id,organization_id,token_prefix,token_hash,enabled)
  values(v_user_id,v_funnel_id,v_org_id,left(v_token,14),encode(extensions.digest(v_token,'sha256'),'hex'),true)
  returning jsonb_build_object('id',id,'funnel_id',funnel_id,'token_prefix',token_prefix,'enabled',enabled,'created_at',created_at) into v_token_row;

  perform public.seed_funnel_structure(v_funnel_id);

  insert into public.funnel_offers(funnel_id,user_id,product_id,step_id,offer_type,name,price,currency,status,config,organization_id)
  values(v_funnel_id,v_user_id,v_product.id,null,'primary',v_product.name,v_product.unit_amount,v_product.currency,'active',jsonb_build_object('source','funnel_provisioning','product_id',v_product.id),v_org_id)
  returning jsonb_build_object('id',id,'funnel_id',funnel_id,'product_id',product_id,'name',name,'price',price,'currency',currency,'status',status) into v_offer;

  insert into public.funnel_gateway_bindings(organization_id,funnel_id,gateway_id,role,priority,is_primary,status)
  values(v_org_id,v_funnel_id,v_gateway.id,'payment',1,true,'active')
  returning jsonb_build_object('id',id,'funnel_id',funnel_id,'gateway_id',gateway_id,'role',role,'priority',priority,'is_primary',is_primary,'status',status) into v_binding;

  return jsonb_build_object(
    'funnel',v_funnel,
    'connection',v_connection,
    'ingestion',v_token_row||jsonb_build_object('token',v_token,'event_endpoint',p_event_endpoint),
    'product',v_offer,
    'gateway',v_binding
  );
end;
$function$;

grant execute on function public.provision_funnel_commercial_atomic(text,text,text,text,text,text,text) to authenticated;
