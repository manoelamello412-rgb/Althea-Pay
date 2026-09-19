alter table public.attribution_sessions
  add column if not exists organization_id uuid,
  add column if not exists visitor_id text,
  add column if not exists customer_id text,
  add column if not exists current_event_type text,
  add column if not exists current_step text,
  add column if not exists current_page_url text,
  add column if not exists session_state text not null default 'active',
  add column if not exists ended_at timestamptz,
  add column if not exists identified_at timestamptz,
  add column if not exists device jsonb not null default '{}'::jsonb;

update public.attribution_sessions a
set organization_id=f.organization_id
from public.funnels f
where a.organization_id is null and a.funnel_id=f.id and a.user_id=f.user_id;

create index if not exists attribution_sessions_org_funnel_live_idx
  on public.attribution_sessions(organization_id,funnel_id,last_seen_at desc)
  where session_state='active';

create index if not exists attribution_sessions_org_visitor_idx
  on public.attribution_sessions(organization_id,visitor_id,last_seen_at desc)
  where visitor_id is not null;

create index if not exists attribution_sessions_org_customer_idx
  on public.attribution_sessions(organization_id,customer_id,last_seen_at desc)
  where customer_id is not null;

create or replace function public.project_attribution_event(
  p_user_id uuid,
  p_funnel_id text,
  p_session_key text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_org_id uuid;
  v_attribution jsonb := coalesce(p_payload->'attribution','{}'::jsonb);
  v_customer jsonb := coalesce(p_payload->'customer','{}'::jsonb);
  v_source text;
  v_medium text;
  v_campaign text;
  v_content text;
  v_term text;
  v_click text;
  v_url text;
  v_visitor_id text;
  v_customer_id text;
  v_step text;
  v_device jsonb;
  v_identified boolean;
begin
  if p_user_id is null or p_funnel_id is null or p_session_key is null or length(trim(p_session_key))=0 then return null; end if;

  select organization_id into v_org_id
  from public.funnels
  where id=p_funnel_id and user_id=p_user_id and deleted_at is null;

  if v_org_id is null then return null; end if;

  v_source=nullif(coalesce(p_payload->>'source',v_attribution->>'source',v_attribution->>'utm_source'),'');
  v_medium=nullif(coalesce(p_payload->>'medium',v_attribution->>'medium',v_attribution->>'utm_medium'),'');
  v_campaign=nullif(coalesce(p_payload->>'campaign',v_attribution->>'campaign',v_attribution->>'utm_campaign'),'');
  v_content=nullif(coalesce(p_payload->>'content',v_attribution->>'content',v_attribution->>'utm_content'),'');
  v_term=nullif(coalesce(p_payload->>'term',v_attribution->>'term',v_attribution->>'utm_term'),'');
  v_click=nullif(coalesce(p_payload->>'click_id',v_attribution->>'click_id'),'');
  v_url=nullif(coalesce(p_payload->>'page_url',p_payload->>'landing_url',v_attribution->>'landing_url'),'');
  v_visitor_id=nullif(coalesce(p_payload->>'visitor_id',p_payload#>>'{_althea,visitor_id}'),'');
  v_customer_id=nullif(coalesce(p_payload->>'customer_id',p_payload->>'external_customer_id',v_customer->>'customer_id'),'');
  v_step=nullif(coalesce(p_payload->>'current_step',p_payload->>'step_key',p_payload->>'step_id'),'');
  v_device=case when jsonb_typeof(p_payload->'device')='object' then p_payload->'device' else '{}'::jsonb end;
  v_identified=(v_customer_id is not null or nullif(v_customer->>'email','') is not null or nullif(v_customer->>'phone','') is not null);

  insert into public.attribution_sessions(
    user_id,organization_id,funnel_id,session_key,visitor_id,customer_id,
    source,medium,campaign,content,term,click_id,landing_url,
    first_seen_at,last_seen_at,current_event_type,current_step,current_page_url,
    session_state,ended_at,identified_at,device,metadata
  ) values(
    p_user_id,v_org_id,p_funnel_id,p_session_key,v_visitor_id,v_customer_id,
    v_source,v_medium,v_campaign,v_content,v_term,v_click,v_url,
    now(),now(),p_event_type,v_step,v_url,
    case when p_event_type='session_ended' then 'ended' else 'active' end,
    case when p_event_type='session_ended' then now() else null end,
    case when v_identified then now() else null end,
    v_device,coalesce(p_payload,'{}'::jsonb)
  )
  on conflict (user_id,funnel_id,session_key) do update set
    organization_id=coalesce(public.attribution_sessions.organization_id,excluded.organization_id),
    visitor_id=coalesce(public.attribution_sessions.visitor_id,excluded.visitor_id),
    customer_id=coalesce(public.attribution_sessions.customer_id,excluded.customer_id),
    source=coalesce(public.attribution_sessions.source,excluded.source),
    medium=coalesce(public.attribution_sessions.medium,excluded.medium),
    campaign=coalesce(public.attribution_sessions.campaign,excluded.campaign),
    content=coalesce(public.attribution_sessions.content,excluded.content),
    term=coalesce(public.attribution_sessions.term,excluded.term),
    click_id=coalesce(public.attribution_sessions.click_id,excluded.click_id),
    landing_url=coalesce(public.attribution_sessions.landing_url,excluded.landing_url),
    last_seen_at=now(),
    current_event_type=excluded.current_event_type,
    current_step=coalesce(excluded.current_step,public.attribution_sessions.current_step),
    current_page_url=coalesce(excluded.current_page_url,public.attribution_sessions.current_page_url),
    session_state=case when excluded.current_event_type='session_ended' then 'ended' else public.attribution_sessions.session_state end,
    ended_at=case when excluded.current_event_type='session_ended' then now() else public.attribution_sessions.ended_at end,
    identified_at=coalesce(public.attribution_sessions.identified_at,excluded.identified_at),
    device=case when excluded.device='{}'::jsonb then public.attribution_sessions.device else excluded.device end,
    metadata=coalesce(public.attribution_sessions.metadata,'{}'::jsonb)||coalesce(excluded.metadata,'{}'::jsonb)
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.project_attribution_event(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.project_attribution_event(uuid,text,text,text,jsonb) to service_role;

create or replace view public.v_funnel_live_journeys
with (security_invoker=true)
as
select
  a.id as session_id,
  a.organization_id,
  a.user_id,
  a.funnel_id,
  a.session_key,
  a.visitor_id,
  a.customer_id,
  nullif(coalesce(a.metadata#>>'{customer,name}',a.metadata#>>'{buyer,name}'),'') as customer_name,
  nullif(coalesce(a.metadata#>>'{customer,email}',a.metadata#>>'{buyer,email}'),'') as customer_email,
  nullif(coalesce(a.metadata#>>'{customer,phone}',a.metadata#>>'{customer,whatsapp}',a.metadata#>>'{buyer,phone}'),'') as customer_phone,
  a.current_event_type,
  a.current_step,
  a.current_page_url,
  a.source,
  a.medium,
  a.campaign,
  a.click_id,
  a.device,
  a.session_state,
  a.first_seen_at,
  a.last_seen_at,
  extract(epoch from (now()-a.last_seen_at))::bigint as idle_seconds,
  a.identified_at
from public.attribution_sessions a
where a.session_state='active'
  and a.last_seen_at >= now()-interval '15 minutes';

revoke all on public.v_funnel_live_journeys from anon;
grant select on public.v_funnel_live_journeys to authenticated;
