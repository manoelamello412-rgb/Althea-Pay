begin;

create table if not exists public.crm_conversation_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.crm_conversation_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.crm_conversations(id) on delete cascade,
  tag text not null check (char_length(trim(tag)) between 1 and 80),
  created_at timestamptz not null default timezone('utc', now()),
  unique (conversation_id, tag)
);

create table if not exists public.crm_ai_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.crm_conversations(id) on delete cascade,
  action_type text not null check (char_length(trim(action_type)) between 1 and 80),
  score numeric(5,2) not null default 0 check (score between 0 and 100),
  rationale text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'suggested' check (status in ('suggested','accepted','dismissed','executed','failed')),
  created_at timestamptz not null default timezone('utc', now()),
  executed_at timestamptz
);

create index if not exists crm_notes_conversation_idx on public.crm_conversation_notes(user_id, conversation_id, created_at desc);
create index if not exists crm_tags_conversation_idx on public.crm_conversation_tags(user_id, conversation_id, tag);
create index if not exists crm_ai_actions_queue_idx on public.crm_ai_actions(user_id, status, score desc, created_at desc);

alter table public.crm_conversation_notes enable row level security;
alter table public.crm_conversation_tags enable row level security;
alter table public.crm_ai_actions enable row level security;

drop policy if exists crm_notes_owner on public.crm_conversation_notes;
create policy crm_notes_owner on public.crm_conversation_notes for all using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists crm_tags_owner on public.crm_conversation_tags;
create policy crm_tags_owner on public.crm_conversation_tags for all using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists crm_ai_actions_owner on public.crm_ai_actions;
create policy crm_ai_actions_owner on public.crm_ai_actions for all using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create or replace function public.crm_customer_360(p_conversation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_user uuid := auth.uid(); v jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if not exists(select 1 from public.crm_conversations c where c.id=p_conversation_id and c.user_id=v_user) then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
  select jsonb_build_object(
    'conversation', (select to_jsonb(c) from public.crm_conversations c where c.id=p_conversation_id and c.user_id=v_user),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at asc) from public.crm_messages m where m.conversation_id=p_conversation_id and m.user_id=v_user),'[]'::jsonb),
    'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from public.crm_conversation_notes n where n.conversation_id=p_conversation_id and n.user_id=v_user),'[]'::jsonb),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.tag asc) from public.crm_conversation_tags t where t.conversation_id=p_conversation_id and t.user_id=v_user),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.received_at desc) from public.crm_webhook_events e where e.user_id=v_user and ((e.transaction_id is not null and e.transaction_id=(select transaction_id from public.crm_conversations where id=p_conversation_id)) or (e.buyer_email is not null and lower(e.buyer_email)=lower((select buyer_email from public.crm_conversations where id=p_conversation_id))))),'[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(s) order by coalesce(s.occurred_at,s.created_at) desc) from public.sales s where s.user_id=v_user and ((s.transaction_id is not null and s.transaction_id::text=(select transaction_id from public.crm_conversations where id=p_conversation_id)) or (s.data->>'email' is not null and lower(s.data->>'email')=lower((select buyer_email from public.crm_conversations where id=p_conversation_id))))),'[]'::jsonb)
  ) into v;
  return v;
end;
$$;

grant execute on function public.crm_customer_360(uuid) to authenticated;

create or replace function public.crm_revenue_intelligence(p_days integer default 30)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_days integer := greatest(1,least(coalesce(p_days,30),365)); v jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  with ss as (
    select s.* from public.sales s where s.user_id=v_user and coalesce(s.occurred_at,s.created_at)>=timezone('utc',now())-(v_days||' days')::interval
  ), ee as (
    select e.* from public.crm_webhook_events e where e.user_id=v_user and e.received_at>=timezone('utc',now())-(v_days||' days')::interval
  ), failed as (
    select e.id,e.status,e.error_reason,e.buyer_email,e.buyer_name,e.transaction_id,e.payload,e.received_at,
      coalesce(nullif((e.payload->>'amount')::numeric,0),nullif((e.payload->'data'->>'amount')::numeric,0),nullif((e.payload->'transaction'->>'amount')::numeric,0),0) amount
    from ee e where lower(e.status) in ('failed','declined','rejected','refused','error','canceled','cancelled','expired')
  ), pending as (
    select e.id,e.status,e.buyer_email,e.buyer_name,e.transaction_id,e.payload,e.received_at,
      coalesce(nullif((e.payload->>'amount')::numeric,0),nullif((e.payload->'data'->>'amount')::numeric,0),nullif((e.payload->'transaction'->>'amount')::numeric,0),0) amount
    from ee e where lower(e.status) in ('pending','waiting','processing','awaiting_payment')
  ), funnel_loss as (
    select coalesce(nullif(payload->>'funnel_id',''),'sem funil') key,count(*)::int events,coalesce(sum(amount),0)::numeric amount from failed group by 1 order by amount desc limit 10
  ), gateway_loss as (
    select coalesce(nullif(coalesce(payload->>'gateway_id',payload->'gateway'->>'id'),''),'gateway não informado') key,count(*)::int events,coalesce(sum(amount),0)::numeric amount from failed group by 1 order by amount desc limit 10
  ), recent as (
    select jsonb_agg(jsonb_build_object('event_id',x.id,'customer',coalesce(x.buyer_name,x.buyer_email,'Cliente'),'email',x.buyer_email,'status',x.status,'amount',x.amount,'reason',x.error_reason,'transaction_id',x.transaction_id,'received_at',x.received_at) order by x.received_at desc) items from (select * from failed order by received_at desc limit 25) x
  ), metrics as (
    select
      (select count(*) from ss)::int sales_count,
      (select coalesce(sum(amount),0) from ss where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded'))::numeric approved_revenue,
      (select count(*) from ss where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded'))::int approved_sales,
      (select count(*) from ee)::int events_count,
      (select count(*) from failed)::int failed_count,
      (select count(*) from pending)::int pending_count,
      (select coalesce(sum(amount),0) from failed)::numeric failed_value,
      (select coalesce(sum(amount),0) from pending)::numeric pending_value,
      (select count(*) from public.crm_conversations c where c.user_id=v_user and c.unread_count>0)::int unread_conversations,
      (select count(*) from public.crm_conversations c where c.user_id=v_user and c.status='open')::int open_conversations,
      (select public.althea_pay_calculate_tmr(v_user))::numeric tmr_seconds
  )
  select jsonb_build_object(
    'window_days',v_days,
    'metrics',(select to_jsonb(metrics) from metrics),
    'loss_by_funnel',coalesce((select jsonb_agg(to_jsonb(f)) from funnel_loss f),'[]'::jsonb),
    'loss_by_gateway',coalesce((select jsonb_agg(to_jsonb(g)) from gateway_loss g),'[]'::jsonb),
    'recent_recovery_signals',coalesce((select items from recent),'[]'::jsonb),
    'generated_at',timezone('utc',now())
  ) into v;
  return v;
end;
$$;

grant execute on function public.crm_revenue_intelligence(integer) to authenticated;

commit;