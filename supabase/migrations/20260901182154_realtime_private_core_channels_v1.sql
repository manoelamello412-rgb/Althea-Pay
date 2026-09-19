drop function if exists public.register_integration_event(uuid,text,text,text,jsonb,timestamptz);
create or replace function public.register_integration_event(p_funnel_id text, p_event_type text, p_external_id text, p_payload jsonb, p_occurred_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  v_key := md5(coalesce(p_funnel_id,'') || ':' || coalesce(p_external_id,'') || ':' || coalesce(p_event_type,'') || ':' || coalesce(p_occurred_at::text,''));
  insert into public.integration_events(user_id,funnel_id,event_type,external_id,status,payload,occurred_at,event_key)
  values(v_user,p_funnel_id,p_event_type,p_external_id,'received',coalesce(p_payload,'{}'::jsonb),coalesce(p_occurred_at,now()),v_key)
  on conflict (event_key) do update set payload=excluded.payload, occurred_at=excluded.occurred_at
  returning id into v_id;
  update public.funnel_connections set last_event_at=now(), health_status='healthy', event_count=coalesce(event_count,0)+1, last_error=null, connected_at=coalesce(connected_at,now()), updated_at=now(), status='connected' where user_id=v_user and funnel_id=p_funnel_id;
  update public.funnels set last_communication=now(), status='connected' where id=p_funnel_id and user_id=v_user;
  return v_id;
end; $$;
revoke execute on function public.register_integration_event(text,text,text,jsonb,timestamptz) from public, anon;
grant execute on function public.register_integration_event(text,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.broadcast_integration_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(jsonb_build_object('id',new.id,'funnel_id',new.funnel_id,'event_type',new.event_type,'status',new.status,'occurred_at',new.occurred_at), 'integration_event', 'user:' || new.user_id::text || ':integrations', false);
  return new;
end; $$;
drop trigger if exists integration_events_broadcast on public.integration_events;
create trigger integration_events_broadcast after insert or update on public.integration_events for each row execute function public.broadcast_integration_event();

create or replace function public.broadcast_funnel_health()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(jsonb_build_object('funnel_id',new.funnel_id,'status',new.status,'health_status',new.health_status,'last_event_at',new.last_event_at,'event_count',new.event_count,'error_count',new.error_count,'last_error',new.last_error), 'funnel_health', 'user:' || new.user_id::text || ':integrations', false);
  return new;
end; $$;
drop trigger if exists funnel_connections_broadcast on public.funnel_connections;
create trigger funnel_connections_broadcast after insert or update on public.funnel_connections for each row execute function public.broadcast_funnel_health();

create policy "althea_private_integration_topics_read" on realtime.messages for select to authenticated using ((select realtime.topic()) = 'user:' || (select auth.uid())::text || ':integrations');
create policy "althea_private_integration_topics_write" on realtime.messages for insert to authenticated with check ((select realtime.topic()) = 'user:' || (select auth.uid())::text || ':integrations');