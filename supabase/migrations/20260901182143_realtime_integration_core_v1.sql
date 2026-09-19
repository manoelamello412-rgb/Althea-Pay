create unique index if not exists funnel_connections_user_funnel_uidx on public.funnel_connections(user_id, funnel_id);
create index if not exists integration_events_user_funnel_created_idx on public.integration_events(user_id, funnel_id, created_at desc);
create index if not exists integration_events_external_id_idx on public.integration_events(funnel_id, external_id) where external_id is not null;
create index if not exists integration_events_status_idx on public.integration_events(user_id, status, created_at desc);
create index if not exists funnel_connections_health_idx on public.funnel_connections(user_id, status, last_event_at desc);

alter table public.funnel_connections add column if not exists health_status text default 'unknown';
alter table public.funnel_connections add column if not exists last_error text;
alter table public.funnel_connections add column if not exists event_count bigint default 0;
alter table public.funnel_connections add column if not exists error_count bigint default 0;
alter table public.funnel_connections add column if not exists connected_at timestamptz;

alter table public.integration_events add column if not exists event_key text;
alter table public.integration_events add column if not exists processed_at timestamptz;
alter table public.integration_events add column if not exists error_message text;
alter table public.integration_events add column if not exists retry_count integer default 0;
create unique index if not exists integration_events_event_key_uidx on public.integration_events(event_key) where event_key is not null;

create or replace function public.mark_integration_event_processed(p_event_id uuid, p_status text default 'processed', p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.integration_events
  set status = p_status, processed_at = now(), error_message = p_error,
      retry_count = case when p_status = 'failed' then coalesce(retry_count,0)+1 else retry_count end
  where id = p_event_id;
end; $$;
revoke execute on function public.mark_integration_event_processed(uuid,text,text) from public, anon, authenticated;

drop function if exists public.register_integration_event(text,text,text,text,jsonb,timestamptz);
create or replace function public.register_integration_event(p_user_id uuid, p_funnel_id text, p_event_type text, p_external_id text, p_payload jsonb, p_occurred_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text;
begin
  v_key := md5(coalesce(p_funnel_id,'') || ':' || coalesce(p_external_id,'') || ':' || coalesce(p_event_type,'') || ':' || coalesce(p_occurred_at::text,''));
  insert into public.integration_events(user_id,funnel_id,event_type,external_id,status,payload,occurred_at,event_key)
  values(p_user_id,p_funnel_id,p_event_type,p_external_id,'received',coalesce(p_payload,'{}'::jsonb),coalesce(p_occurred_at,now()),v_key)
  on conflict (event_key) do update set payload=excluded.payload, occurred_at=excluded.occurred_at
  returning id into v_id;
  update public.funnel_connections
    set last_event_at=now(), health_status='healthy', event_count=coalesce(event_count,0)+1,
        last_error=null, connected_at=coalesce(connected_at,now()), updated_at=now(), status='connected'
  where user_id=p_user_id and funnel_id=p_funnel_id;
  update public.funnels set last_communication=now(), status='connected'
  where id=p_funnel_id and user_id=p_user_id;
  return v_id;
end; $$;
revoke execute on function public.register_integration_event(uuid,text,text,text,jsonb,timestamptz) from public, anon;
grant execute on function public.register_integration_event(uuid,text,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.get_funnel_connection_health(p_user_id uuid)
returns table(funnel_id text, status text, health_status text, last_event_at timestamptz, event_count bigint, error_count bigint, last_error text)
language sql security definer set search_path = public as $$
  select fc.funnel_id, fc.status, fc.health_status, fc.last_event_at, fc.event_count, fc.error_count, fc.last_error
  from public.funnel_connections fc where fc.user_id=p_user_id order by fc.last_event_at desc nulls last;
$$;
revoke execute on function public.get_funnel_connection_health(uuid) from public, anon;
grant execute on function public.get_funnel_connection_health(uuid) to authenticated;