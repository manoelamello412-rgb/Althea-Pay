create or replace function public.save_funnel_domain_connection(
  p_funnel_id text,
  p_name text,
  p_url text,
  p_external_funnel_id text,
  p_pixel_id text,
  p_chat_enabled boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_funnel public.funnels%rowtype;
  v_connection public.funnel_connections%rowtype;
  v_config jsonb;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  if nullif(trim(p_funnel_id), '') is null then raise exception 'funnel_id_required'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'name_required'; end if;
  if nullif(trim(p_external_funnel_id), '') is null then raise exception 'external_funnel_id_required'; end if;

  select * into v_funnel
  from public.funnels
  where id = trim(p_funnel_id)
    and user_id = v_user_id
    and deleted_at is null
  for update;

  if not found then raise exception 'funnel_not_found'; end if;

  v_config := jsonb_build_object(
    'protocol_version', '2026-09',
    'external_funnel_id', trim(p_external_funnel_id),
    'pixel_id', nullif(trim(coalesce(p_pixel_id, '')), ''),
    'chat_enabled', coalesce(p_chat_enabled, true),
    'updated_at', timezone('utc', now())
  );

  update public.funnels
  set nome = trim(p_name),
      url = nullif(trim(coalesce(p_url, '')), ''),
      status = 'active',
      last_communication = timezone('utc', now())
  where id = v_funnel.id and user_id = v_user_id;

  select * into v_connection
  from public.funnel_connections
  where funnel_id = v_funnel.id and user_id = v_user_id
  order by created_at asc
  limit 1
  for update;

  if found then
    update public.funnel_connections
    set status = 'active',
        config = coalesce(config, '{}'::jsonb) || v_config,
        connected_at = coalesce(connected_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = v_connection.id and user_id = v_user_id
    returning * into v_connection;
  else
    insert into public.funnel_connections(user_id, funnel_id, connection_type, status, config, connected_at, updated_at)
    values (v_user_id, v_funnel.id, 'script', 'active', v_config, timezone('utc', now()), timezone('utc', now()))
    returning * into v_connection;
  end if;

  return jsonb_build_object('funnel_id', v_funnel.id, 'connection_id', v_connection.id, 'status', v_connection.status);
end;
$$;

grant execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean) to authenticated;
revoke execute on function public.save_funnel_domain_connection(text,text,text,text,text,boolean) from public;
