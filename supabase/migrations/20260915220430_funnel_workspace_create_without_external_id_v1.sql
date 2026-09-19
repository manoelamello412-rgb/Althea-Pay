create or replace function public.save_funnel_domain_connection(p_funnel_id text, p_name text, p_url text, p_external_funnel_id text, p_pixel_id text, p_chat_enabled boolean, p_expected_updated_at timestamp with time zone default null)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_funnel public.funnels%rowtype;
  v_config jsonb;
  v_now timestamptz := now();
  v_rows integer;
begin
  if v_user_id is null then
    raise exception using errcode='42501', message='unauthorized';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception using errcode='22023', message='funnel name is required';
  end if;
  select * into v_funnel
    from public.funnels
   where id = p_funnel_id
     and user_id = v_user_id
     and deleted_at is null
   for update;
  if not found then
    raise exception using errcode='P0002', message='funnel_not_found';
  end if;
  if p_expected_updated_at is not null and coalesce((to_jsonb(v_funnel)->>'updated_at')::timestamptz, v_funnel.created_at) <> p_expected_updated_at then
    raise exception using errcode='40001', message='funnel_conflict';
  end if;
  update public.funnels
     set nome = trim(p_name),
         url = nullif(trim(p_url), ''),
         status = 'active',
         last_communication = coalesce(last_communication, v_now)
   where id = v_funnel.id and user_id = v_user_id;
  v_config := jsonb_build_object(
    'protocol_version','2026-09',
    'external_funnel_id', nullif(trim(coalesce(p_external_funnel_id,'')),''),
    'pixel_id', nullif(trim(coalesce(p_pixel_id,'')),''),
    'chat_enabled', coalesce(p_chat_enabled,true),
    'updated_at', v_now
  );
  update public.funnel_connections
     set config = coalesce(config,'{}'::jsonb) || v_config,
         status = 'active',
         health_status = coalesce(health_status,'unknown'),
         updated_at = v_now
   where funnel_id = v_funnel.id and user_id = v_user_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    insert into public.funnel_connections(user_id,funnel_id,organization_id,connection_type,status,config,health_status,connected_at,updated_at)
    select v_user_id,v_funnel.id,v_funnel.organization_id,'script','active',v_config,'unknown',v_now,v_now;
  end if;
  return jsonb_build_object('funnel_id',v_funnel.id,'user_id',v_user_id,'updated_at',v_now,'config',v_config);
end;
$function$;

revoke execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean) from anon;
revoke execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean,timestamptz) from anon;
grant execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean) to authenticated;
grant execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean,timestamptz) to authenticated;