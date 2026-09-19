create or replace function public.register_integration_event(
  p_funnel_id text,
  p_event_type text,
  p_external_id text,
  p_payload jsonb,
  p_occurred_at timestamp with time zone default now()
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_key text;
  v_user uuid := auth.uid();
  v_funnel_exists boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select exists(
    select 1
    from public.funnels f
    where f.id = p_funnel_id
      and f.user_id = v_user
  ) into v_funnel_exists;

  if not v_funnel_exists then
    raise exception 'funnel_not_found';
  end if;

  v_key := md5(
    v_user::text || ':' ||
    coalesce(p_funnel_id,'') || ':' ||
    coalesce(p_external_id,'') || ':' ||
    coalesce(p_event_type,'') || ':' ||
    coalesce(p_occurred_at::text,'')
  );

  insert into public.integration_events(
    user_id,
    funnel_id,
    event_type,
    external_id,
    status,
    payload,
    occurred_at,
    event_key
  )
  values(
    v_user,
    p_funnel_id,
    p_event_type,
    p_external_id,
    'received',
    coalesce(p_payload,'{}'::jsonb),
    coalesce(p_occurred_at,now()),
    v_key
  )
  on conflict (event_key) do update
    set payload = excluded.payload,
        occurred_at = excluded.occurred_at
  returning id into v_id;

  update public.funnel_connections
     set last_event_at = now(),
         health_status = 'healthy',
         event_count = coalesce(event_count,0) + 1,
         last_error = null,
         connected_at = coalesce(connected_at,now()),
         updated_at = now(),
         status = 'connected'
   where user_id = v_user
     and funnel_id = p_funnel_id;

  update public.funnels
     set last_communication = now(),
         status = 'connected'
   where id = p_funnel_id
     and user_id = v_user;

  return v_id;
end;
$function$;

revoke execute on function public.register_integration_event(text,text,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.register_integration_event(text,text,text,jsonb,timestamptz) to authenticated;
