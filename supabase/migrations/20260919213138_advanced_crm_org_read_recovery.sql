alter table public.crm_predictive_evaluations
  add column if not exists actor_id uuid null references auth.users(id) on delete set null;

create index if not exists crm_predictive_evaluations_actor_idx
  on public.crm_predictive_evaluations(actor_id)
  where actor_id is not null;

create or replace function private.crm_access_context(
  p_conversation_id uuid,
  p_need_values boolean default false,
  p_need_customers boolean default false,
  p_need_reply boolean default false
)
returns table(
  organization_id uuid,
  owner_user_id uuid,
  history_start timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_hours integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  v_org := private.current_organization_id();
  if v_org is null then
    raise exception 'ORGANIZATION_ACCESS_DENIED' using errcode='42501';
  end if;

  if not private.has_org_capability(v_org,'can_view_chats') then
    raise exception 'CHAT_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_need_values and not private.has_org_capability(v_org,'can_view_values') then
    raise exception 'VALUE_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_need_customers and not private.has_org_capability(v_org,'can_view_customers') then
    raise exception 'CUSTOMER_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_need_reply and not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'REPLY_ACCESS_DENIED' using errcode='42501';
  end if;

  v_hours := private.org_operational_history_hours(v_org);
  if v_hours <= 0 then
    raise exception 'OPERATIONAL_ACCESS_DENIED' using errcode='42501';
  end if;

  select c.user_id
    into v_owner
  from public.crm_conversations c
  where c.id=p_conversation_id
    and c.organization_id=v_org
    and c.updated_at >= now()-make_interval(hours=>v_hours)
  limit 1;

  if v_owner is null then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  return query
  select v_org, v_owner, now()-make_interval(hours=>v_hours);
end;
$function$;

revoke all on function private.crm_access_context(uuid,boolean,boolean,boolean)
  from public, anon, authenticated;

create or replace function public.crm_customer_360(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  v_values boolean;
  v_gateways boolean;
  v jsonb;
begin
  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,false,true,false);

  v_values := private.has_org_capability(v_org,'can_view_values');
  v_gateways := private.has_org_capability(v_org,'can_manage_gateways');

  with base as (
    select
      c.*,
      cl.id as canonical_customer_id,
      cl.data as canonical_customer_data,
      lower(nullif(trim(coalesce(
        cl.data->>'email',
        cl.data->>'buyer_email',
        cl.data->>'customer_email',
        c.buyer_email
      )),'')) as email_key
    from public.crm_conversations c
    left join public.clients cl
      on cl.organization_id=c.organization_id
     and cl.id=c.customer_id
    where c.id=p_conversation_id
      and c.organization_id=v_org
      and c.updated_at>=v_start
  ),
  related_conversations as (
    select c.*
    from public.crm_conversations c, base b
    where c.organization_id=v_org
      and c.updated_at>=v_start
      and (
        (b.canonical_customer_id is not null and c.customer_id=b.canonical_customer_id)
        or
        (b.canonical_customer_id is null and b.email_key is not null and lower(c.buyer_email)=b.email_key)
      )
  ),
  related_sales as (
    select distinct s.*
    from public.sales s, base b
    where v_values
      and s.organization_id=v_org
      and coalesce(s.occurred_at,s.created_at)>=v_start
      and (
        (b.canonical_customer_id is not null and coalesce(s.data->>'customer_id','')=b.canonical_customer_id)
        or
        (b.email_key is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=b.email_key)
        or
        (b.transaction_id is not null and s.transaction_id::text=b.transaction_id)
      )
  ),
  related_checkouts as (
    select cs.*
    from public.checkout_sessions cs, base b
    where v_values
      and cs.organization_id=v_org
      and cs.created_at>=v_start
      and b.email_key is not null
      and lower(coalesce(cs.customer->>'email',cs.customer->>'buyer_email',''))=b.email_key
  ),
  related_attempts as (
    select a.*
    from public.gateway_payment_attempts a
    join related_sales s on s.id=a.sale_id
    where v_values
      and a.organization_id=v_org
      and a.created_at>=v_start
  ),
  related_events as (
    select e.*
    from public.crm_webhook_events e, base b
    where v_values
      and e.organization_id=v_org
      and e.received_at>=v_start
      and (
        (b.transaction_id is not null and e.transaction_id=b.transaction_id)
        or
        (b.email_key is not null and lower(e.buyer_email)=b.email_key)
      )
  ),
  approved_sales as (
    select * from related_sales
    where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded')
  ),
  message_window as (
    select m.*
    from public.crm_messages m
    join related_conversations c on c.id=m.conversation_id
    where m.organization_id=v_org
      and m.created_at>=v_start
    order by m.created_at desc
    limit 500
  ),
  aggregates as (
    select
      (select count(*)::int from related_conversations) conversations,
      (select count(*)::int from related_conversations where unread_count>0) unread,
      case when v_values then (select count(*)::int from related_sales) else 0 end sales_count,
      case when v_values then (select count(*)::int from approved_sales) else 0 end approved_sales_count,
      case when v_values then (select coalesce(sum(amount),0)::numeric from approved_sales) else 0::numeric end approved_revenue,
      case when v_values then (select coalesce(sum(amount),0)::numeric from related_sales) else 0::numeric end gross_tracked_value,
      case when v_values then (select count(*)::int from related_checkouts) else 0 end checkout_count,
      case when v_values then (select count(*)::int from related_checkouts where status='completed') else 0 end completed_checkouts,
      case when v_values then (select count(*)::int from related_checkouts where status in ('abandoned','expired')) else 0 end abandoned_checkouts,
      case when v_values then (select count(*)::int from related_attempts) else 0 end payment_attempts,
      case when v_values then (select count(*)::int from related_attempts where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded')) else 0 end approved_attempts,
      case when v_values then (select count(*)::int from related_events) else 0 end event_count,
      case when v_values then (select count(*)::int from related_events where lower(coalesce(status,'')) in ('failed','declined','rejected','refused','error','canceled','cancelled','expired')) else 0 end failed_events,
      case when v_values then (select count(*)::int from related_events where lower(coalesce(status,'')) in ('pending','waiting','processing','awaiting_payment')) else 0 end pending_events,
      (select count(*)::int from message_window where direction='inbound') inbound_messages,
      (select count(*)::int from message_window where direction='outbound') outbound_messages,
      (select count(*)::int
         from public.crm_conversation_notes n
         join related_conversations c on c.id=n.conversation_id
        where n.organization_id=v_org
          and n.created_at>=v_start) notes_count,
      (select count(*)::int
         from public.crm_conversation_tags t
         join related_conversations c on c.id=t.conversation_id
        where t.organization_id=v_org
          and t.created_at>=v_start) tag_count
  ),
  scores as (
    select
      least(100,greatest(0,
        least(25,a.inbound_messages*2)
        + case when a.unread>0 then 10 else 0 end
        + case when v_values and a.approved_sales_count>0 then 45 else 0 end
        + case when v_values then least(20,a.completed_checkouts*8) else 0 end
      ))::int engagement_score,
      case when v_values then least(100,greatest(0,
        case when a.approved_sales_count>0 then 55 else 0 end
        + least(25,a.completed_checkouts*8)
        + least(20,a.approved_attempts*5)
      ))::int else null::int end conversion_score,
      case when v_values then least(100,greatest(0,
        case when a.abandoned_checkouts>0 then 35 else 0 end
        + least(25,a.pending_events*5)
        + least(25,a.failed_events*4)
        + case when a.unread>0 then 15 else 0 end
      ))::int else null::int end recovery_score
    from aggregates a
  )
  select jsonb_build_object(
    'profile',(
      select jsonb_build_object(
        'conversation',
        (
          to_jsonb(b)
          - 'canonical_customer_data'
          - 'email_key'
          - 'public_token'
          - 'metadata'
          - 'gateway_error_log'
        )
        || jsonb_build_object(
          'metadata',private.redact_crm_metadata(b.metadata,v_values,true),
          'gateway_error_log',case when v_gateways then b.gateway_error_log else null end
        ),
        'customer',
        case when b.canonical_customer_id is not null then
          jsonb_build_object(
            'id',b.canonical_customer_id,
            'data',private.redact_crm_metadata(b.canonical_customer_data,v_values,true)
          )
        else null end
      )
      from base b
    ),
    'conversations',
    coalesce((
      select jsonb_agg(
        (
          to_jsonb(c)-'public_token'-'metadata'-'gateway_error_log'
        )
        || jsonb_build_object(
          'metadata',private.redact_crm_metadata(c.metadata,v_values,true),
          'gateway_error_log',case when v_gateways then c.gateway_error_log else null end
        )
        order by c.updated_at desc
      )
      from related_conversations c
    ),'[]'::jsonb),
    'messages',
    coalesce((
      select jsonb_agg(
        (to_jsonb(m)-'metadata')
        || jsonb_build_object('metadata',private.redact_crm_metadata(m.metadata,v_values,true))
        order by m.created_at desc
      )
      from message_window m
    ),'[]'::jsonb),
    'notes',
    coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from public.crm_conversation_notes n
      join related_conversations c on c.id=n.conversation_id
      where n.organization_id=v_org
        and n.created_at>=v_start
    ),'[]'::jsonb),
    'tags',
    coalesce((
      select jsonb_agg(to_jsonb(t) order by t.tag asc)
      from public.crm_conversation_tags t
      join related_conversations c on c.id=t.conversation_id
      where t.organization_id=v_org
        and t.created_at>=v_start
    ),'[]'::jsonb),
    'sales',
    case when v_values then coalesce((
      select jsonb_agg(
        (to_jsonb(s)-'data')
        || jsonb_build_object('data',private.redact_crm_metadata(s.data,true,true))
        order by coalesce(s.occurred_at,s.created_at) desc
      )
      from related_sales s
    ),'[]'::jsonb) else '[]'::jsonb end,
    'checkouts',
    case when v_values then coalesce((
      select jsonb_agg(
        (to_jsonb(cs)-'customer'-'metadata')
        || jsonb_build_object(
          'customer',private.redact_crm_metadata(cs.customer,true,true),
          'metadata',private.redact_crm_metadata(cs.metadata,true,true)
        )
        order by cs.created_at desc
      )
      from related_checkouts cs
    ),'[]'::jsonb) else '[]'::jsonb end,
    'payment_attempts',
    case when v_values and v_gateways then coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from related_attempts a
    ),'[]'::jsonb) else '[]'::jsonb end,
    'events',
    case when v_values then coalesce((
      select jsonb_agg(
        (to_jsonb(e)-'payload')
        || jsonb_build_object('payload',private.redact_crm_metadata(e.payload,true,true))
        order by e.received_at desc
      )
      from related_events e
    ),'[]'::jsonb) else '[]'::jsonb end,
    'aggregates',(select to_jsonb(a) from aggregates a),
    'scores',(select to_jsonb(s) from scores s),
    'generated_at',timezone('utc',now())
  ) into v;

  return v;
end;
$function$;

revoke all on function public.crm_customer_360(uuid) from public, anon;
grant execute on function public.crm_customer_360(uuid) to authenticated;

create or replace function public.crm_predictive_scores(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  v jsonb;
begin
  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,true,true,false);

  with c as (
    select *
    from public.crm_conversations
    where id=p_conversation_id
      and organization_id=v_org
      and updated_at>=v_start
  ),
  inbound as (
    select count(*)::int n,max(created_at) last_at
    from public.crm_messages
    where organization_id=v_org
      and conversation_id=p_conversation_id
      and direction='inbound'
      and created_at>=v_start
  ),
  sales_agg as (
    select
      count(*)::int n,
      coalesce(sum(case when lower(coalesce(s.status,'')) in ('paid','approved','completed','succeeded') then coalesce(s.amount,0) else 0 end),0)::numeric revenue,
      count(*) filter(where lower(coalesce(s.status,'')) in ('paid','approved','completed','succeeded'))::int approved
    from public.sales s
    join c on s.organization_id=c.organization_id
    where coalesce(s.occurred_at,s.created_at)>=v_start
      and (
        (c.customer_id is not null and s.data->>'customer_id'=c.customer_id)
        or
        (c.buyer_email is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=lower(c.buyer_email))
        or
        (c.transaction_id is not null and s.transaction_id::text=c.transaction_id)
      )
  ),
  pending as (
    select count(*)::int n
    from public.crm_webhook_events e
    join c on e.organization_id=c.organization_id
    where e.received_at>=v_start
      and (
        (c.transaction_id is not null and e.transaction_id=c.transaction_id)
        or
        (c.buyer_email is not null and lower(coalesce(e.buyer_email,e.payload->>'email',''))=lower(c.buyer_email))
      )
      and lower(coalesce(e.status,'')) in ('pending','received','retrying')
  ),
  base as (
    select
      greatest(0,least(100,25+least(25,inbound.n*8)+least(25,sales_agg.approved*15)+least(15,sales_agg.revenue/100)+least(10,pending.n*5)))::numeric conversion,
      greatest(0,least(100,15+least(30,inbound.n*10)+least(20,pending.n*12)+case when inbound.last_at>=now()-interval '24 hours' then 25 else 0 end+least(10,sales_agg.revenue/200)))::numeric recovery,
      greatest(0,least(100,20+least(25,sales_agg.approved*12)+least(25,sales_agg.revenue/250)+least(20,inbound.n*5)+case when inbound.last_at>=now()-interval '7 days' then 10 else 0 end))::numeric ltv
    from inbound,sales_agg,pending
  ),
  scored as (
    select *,round((conversion*0.45+recovery*0.30+ltv*0.25),2) overall
    from base
  )
  select jsonb_build_object(
    'conversation_id',p_conversation_id,
    'conversion_probability',round(conversion,2),
    'recovery_probability',round(recovery,2),
    'ltv_propensity',round(ltv,2),
    'overall_score',overall,
    'confidence',case when overall>=70 then 'high' when overall>=45 then 'medium' else 'low' end,
    'method','deterministic_behavioral_v2_org',
    'explainability',jsonb_build_object(
      'inputs','organization-scoped CRM messages, related sales, pending webhook events',
      'note','Transparent behavioral heuristics; requires customer and financial visibility.'
    ),
    'generated_at',now()
  )
  into v
  from scored;

  return v;
end;
$function$;

revoke all on function public.crm_predictive_scores(uuid) from public, anon;
grant execute on function public.crm_predictive_scores(uuid) to authenticated;

create or replace function public.crm_predictive_snapshot(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  s jsonb;
  v_snapshot_id uuid;
  mv text;
begin
  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,true,true,false);

  s:=public.crm_predictive_scores(p_conversation_id);
  mv:=coalesce(s->>'method','deterministic_behavioral_v2_org');

  select e.id
    into v_snapshot_id
  from public.crm_predictive_evaluations e
  where e.organization_id=v_org
    and e.conversation_id=p_conversation_id
    and e.model_version=mv
    and e.created_at>=now()-interval '5 minutes'
  order by e.created_at desc
  limit 1;

  if v_snapshot_id is not null then
    return v_snapshot_id;
  end if;

  insert into public.crm_predictive_evaluations(
    user_id,organization_id,actor_id,conversation_id,model_version,
    predicted_conversion,predicted_recovery,predicted_ltv,
    actual_conversion,actual_recovery,actual_ltv,evaluated_at
  )
  values(
    v_owner,v_org,auth.uid(),p_conversation_id,mv,
    (s->>'conversion_probability')::numeric/100,
    (s->>'recovery_probability')::numeric/100,
    (s->>'ltv_propensity')::numeric/100,
    null,null,null,null
  )
  returning id into v_snapshot_id;

  return v_snapshot_id;
end;
$function$;

revoke all on function public.crm_predictive_snapshot(uuid) from public, anon;
grant execute on function public.crm_predictive_snapshot(uuid) to authenticated;

create or replace function public.crm_next_best_action(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  v jsonb;
begin
  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,true,true,false);

  with c as (
    select * from public.crm_conversations
    where id=p_conversation_id and organization_id=v_org and updated_at>=v_start
  ),
  s as (
    select
      coalesce(sum(case when lower(coalesce(status,'')) in ('approved','paid','completed','succeeded') then coalesce(amount,0) else 0 end),0) revenue,
      count(*) filter(where lower(coalesce(status,'')) in ('approved','paid','completed','succeeded')) approved_sales,
      count(*) total_sales
    from public.sales
    where organization_id=v_org
      and coalesce(occurred_at,created_at)>=v_start
      and (
        ((select buyer_email from c) is not null and lower(coalesce(data->>'email',data->>'buyer_email',data->>'customer_email',''))=lower((select buyer_email from c)))
        or
        ((select transaction_id from c) is not null and transaction_id::text=(select transaction_id::text from c))
      )
  ),
  m as (
    select count(*) inbound_count
    from public.crm_messages
    where organization_id=v_org
      and conversation_id=p_conversation_id
      and direction='inbound'
      and created_at>=v_start
  ),
  o as (
    select count(*) pending
    from public.crm_webhook_events
    where organization_id=v_org
      and received_at>=v_start
      and (select transaction_id from c) is not null
      and transaction_id::text=(select transaction_id::text from c)
      and lower(coalesce(status,'')) in ('pending','waiting','requires_action')
  ),
  d as (
    select
      case
        when (select pending from o)>0 then 'payment_follow_up'
        when (select approved_sales from s)>0 then 'upsell_or_post_sale'
        when (select inbound_count from m)>0 then 'sales_follow_up'
        when (select total_sales from s)>0 then 'recovery_follow_up'
        else 'qualification'
      end action,
      case
        when (select pending from o)>0 then .92
        when (select approved_sales from s)>0 then .86
        when (select inbound_count from m)>0 then .81
        when (select total_sales from s)>0 then .76
        else .55
      end probability
  )
  select jsonb_build_object(
    'conversation_id',p_conversation_id,
    'action',d.action,
    'probability',d.probability,
    'revenue',s.revenue,
    'approved_sales',s.approved_sales,
    'inbound_count',m.inbound_count,
    'pending_payment_events',o.pending,
    'reason',
      case d.action
        when 'payment_follow_up' then 'Pagamento pendente exige intervenção imediata.'
        when 'upsell_or_post_sale' then 'Cliente com compra aprovada: avançar no pós-venda ou upsell.'
        when 'sales_follow_up' then 'Cliente iniciou conversa e requer condução comercial.'
        when 'recovery_follow_up' then 'Há histórico de tentativa de compra sem aprovação.'
        else 'Poucos sinais comerciais: priorizar qualificação.'
      end,
    'generated_at',timezone('utc',now())
  )
  into v
  from s,m,o,d;

  return v;
end;
$function$;

revoke all on function public.crm_next_best_action(uuid) from public, anon;
grant execute on function public.crm_next_best_action(uuid) to authenticated;

create or replace function public.crm_next_best_actions(p_conversation_id uuid default null)
returns table(action_type text, priority integer, score numeric, rationale text, evidence jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_owner uuid;
  v_start timestamptz;
  r public.crm_conversations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  if p_conversation_id is null then
    v_org:=private.current_organization_id();
    if v_org is null or not private.has_org_capability(v_org,'can_view_chats') then
      raise exception 'CHAT_ACCESS_DENIED' using errcode='42501';
    end if;
    v_start:=now()-make_interval(hours=>private.org_operational_history_hours(v_org));

    return query
    select
      'queue_review'::text,
      80,
      80::numeric,
      'Revisar fila operacional priorizando SLA e conversas não respondidas.',
      jsonb_build_object(
        'open_conversations',
        (select count(*) from public.crm_conversations c
          where c.organization_id=v_org
            and c.updated_at>=v_start
            and c.status<>'closed')
      );
    return;
  end if;

  select organization_id,owner_user_id,history_start
    into v_org,v_owner,v_start
  from private.crm_access_context(p_conversation_id,true,true,false);

  select c.*
    into r
  from public.crm_conversations c
  where c.id=p_conversation_id
    and c.organization_id=v_org
    and c.updated_at>=v_start;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002';
  end if;

  return query
  with stats as (
    select
      r.id conversation_id,
      coalesce((select count(*) from public.crm_messages m
        where m.conversation_id=r.id
          and m.organization_id=v_org
          and m.created_at>=v_start
          and m.direction='inbound'),0)::int inbound_count,
      coalesce((select count(*) from public.crm_messages m
        where m.conversation_id=r.id
          and m.organization_id=v_org
          and m.created_at>=v_start
          and m.direction='outbound'),0)::int outbound_count,
      coalesce((select sum(s.amount) from public.sales s
        where s.organization_id=v_org
          and coalesce(s.occurred_at,s.created_at)>=v_start
          and (
            (r.transaction_id is not null and s.transaction_id::text=r.transaction_id)
            or
            (r.buyer_email is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=lower(r.buyer_email))
          )),0)::numeric revenue,
      coalesce((select count(*) from public.crm_webhook_events e
        where e.organization_id=v_org
          and e.received_at>=v_start
          and (
            (r.transaction_id is not null and e.transaction_id=r.transaction_id)
            or
            (r.buyer_email is not null and lower(coalesce(e.buyer_email,''))=lower(r.buyer_email))
          )),0)::int event_count
  )
  select
    'respond'::text,100,
    greatest(0,least(100,60
      +case when s.inbound_count>s.outbound_count then 30 else 0 end
      +case when r.last_inbound_at is not null and r.first_response_at is null then 10 else 0 end))::numeric,
    case
      when r.first_response_at is null and r.last_inbound_at is not null then 'Cliente aguarda primeira resposta.'
      when s.inbound_count>s.outbound_count then 'Há mensagens recebidas sem resposta correspondente.'
      else 'Manter acompanhamento ativo da conversa.'
    end,
    jsonb_build_object('inbound_count',s.inbound_count,'outbound_count',s.outbound_count,'last_inbound_at',r.last_inbound_at,'first_response_at',r.first_response_at)
  from stats s
  where r.status<>'closed'
  union all
  select
    'recover'::text,90,
    greatest(0,least(100,case when s.event_count>0 and s.revenue=0 then 85 else 20 end))::numeric,
    case when s.event_count>0 and s.revenue=0
      then 'Existem eventos financeiros sem receita observada; avaliar recuperação.'
      else 'Sem sinal forte de recuperação financeira.'
    end,
    jsonb_build_object('event_count',s.event_count,'observed_revenue',s.revenue)
  from stats s
  where r.status<>'closed' and s.event_count>0
  union all
  select
    'upsell'::text,70,65::numeric,
    'Cliente possui receita observada; avaliar oferta complementar com base no histórico real.',
    jsonb_build_object('observed_revenue',s.revenue)
  from stats s
  where r.status<>'closed' and s.revenue>0
  order by 2 desc,3 desc;
end;
$function$;

revoke all on function public.crm_next_best_actions(uuid) from public, anon;
grant execute on function public.crm_next_best_actions(uuid) to authenticated;

create or replace function public.crm_recovery_opportunities(p_days integer default 7)
returns table(
  event_id uuid,
  received_at timestamptz,
  status text,
  transaction_id text,
  buyer_name text,
  buyer_email text,
  funnel_id text,
  product_id text,
  amount numeric,
  currency text,
  priority integer,
  opportunity_type text,
  next_action text,
  conversation_id uuid,
  context_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_org uuid;
  v_hours integer;
  v_start timestamptz;
  v_customers boolean;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode='42501';
  end if;

  v_org:=private.current_organization_id();
  if v_org is null
     or not private.has_org_capability(v_org,'can_view_chats')
     or not private.has_org_capability(v_org,'can_view_values') then
    raise exception 'RECOVERY_ACCESS_DENIED' using errcode='42501';
  end if;

  v_hours:=private.org_operational_history_hours(v_org);
  v_start:=greatest(
    now()-make_interval(days=>greatest(1,least(coalesce(p_days,7),30))),
    now()-make_interval(hours=>v_hours)
  );
  v_customers:=private.has_org_capability(v_org,'can_view_customers');

  return query
  with raw as (
    select
      e.id event_id,
      e.received_at,
      lower(coalesce(e.status,'')) event_status,
      e.transaction_id,
      e.buyer_name,
      e.buyer_email,
      nullif(coalesce(e.payload->>'funnel_id',e.payload->>'funnelId'),'') funnel_id,
      nullif(coalesce(e.payload->>'product_id',e.payload->>'productId'),'') product_id,
      coalesce(e.payload->>'amount',e.payload->>'value',e.payload->>'total',e.payload->'payment'->>'amount',e.payload->'transaction'->>'amount') amount_text,
      coalesce(e.payload->>'currency',e.payload->'payment'->>'currency','BRL') currency,
      e.processed_at
    from public.crm_webhook_events e
    where e.organization_id=v_org
      and e.received_at>=v_start
      and lower(coalesce(e.status,'')) in ('failed','declined','pending','abandoned','waiting','created')
  ),
  base as (
    select r.*,
      case when r.amount_text ~ '^[+-]?[0-9]+([.,][0-9]+)?$'
        then replace(r.amount_text,',','.')::numeric
        else null
      end amount
    from raw r
  ),
  scored as (
    select b.*,
      case when b.event_status in ('failed','declined') then 60
           when b.event_status in ('pending','waiting') then 50 else 40 end
      +case when b.amount is not null and b.amount>=500 then 20
            when b.amount is not null and b.amount>=100 then 10 else 0 end
      +case when b.buyer_email is not null then 5 else 0 end
      +case when b.received_at>=now()-interval '30 minutes' then 15
            when b.received_at>=now()-interval '6 hours' then 10
            when b.received_at>=now()-interval '24 hours' then 5 else 0 end priority
    from base b
  ),
  linked as (
    select s.*,
      (
        select array_agg(c.id)
        from public.crm_conversations c
        where c.organization_id=v_org
          and c.updated_at>=v_start
          and s.transaction_id is not null
          and c.transaction_id=s.transaction_id
      ) candidate_ids
    from scored s
  )
  select
    l.event_id,
    l.received_at,
    l.event_status,
    l.transaction_id,
    case when v_customers then l.buyer_name else null end,
    case when v_customers then l.buyer_email else null end,
    l.funnel_id,
    l.product_id,
    l.amount,
    l.currency,
    least(100,l.priority)::integer,
    case when l.event_status in ('failed','declined') then 'payment_failed'
         when l.event_status in ('pending','waiting') then 'payment_pending'
         else 'checkout_abandoned' end,
    case when l.event_status in ('failed','declined') then 'Recuperar pagamento e oferecer alternativa de pagamento.'
         when l.event_status in ('pending','waiting') then 'Acompanhar pendência e conduzir o cliente à conclusão.'
         else 'Retomar a jornada e devolver o cliente ao checkout.' end,
    case when coalesce(array_length(l.candidate_ids,1),0)=1 then l.candidate_ids[1] else null end,
    case
      when l.transaction_id is null then 'unlinked'
      when coalesce(array_length(l.candidate_ids,1),0)=0 then 'unlinked'
      when array_length(l.candidate_ids,1)=1 then 'resolved'
      else 'ambiguous'
    end
  from linked l
  where l.processed_at is null
  order by l.priority desc,l.received_at desc;
end;
$function$;

revoke all on function public.crm_recovery_opportunities(integer) from public, anon;
grant execute on function public.crm_recovery_opportunities(integer) to authenticated;

create or replace function public.crm_recovery_execute(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor uuid:=auth.uid();
  v_org uuid;
  v_hours integer;
  v_start timestamptz;
  v_event public.crm_webhook_events%rowtype;
  v_agent public.crm_agents%rowtype;
  v_conv public.crm_conversations%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_lock_key bigint;
  v_assigned uuid;
  v_name text;
begin
  if v_actor is null then
    raise exception 'unauthorized' using errcode='42501';
  end if;

  v_org:=private.current_organization_id();
  if v_org is null
     or not private.has_org_capability(v_org,'can_view_chats')
     or not private.has_org_capability(v_org,'can_view_values')
     or not private.has_org_capability(v_org,'can_reply_chats') then
    raise exception 'recovery_forbidden' using errcode='42501';
  end if;

  v_hours:=private.org_operational_history_hours(v_org);
  v_start:=now()-make_interval(hours=>v_hours);

  select *
    into v_event
  from public.crm_webhook_events
  where id=p_event_id
    and organization_id=v_org
    and received_at>=v_start
  for update;

  if not found then
    raise exception 'event_not_found' using errcode='P0002';
  end if;

  if v_event.processed_at is not null then
    select *
      into v_conv
    from public.crm_conversations
    where organization_id=v_org
      and metadata->>'recovery_event_id'=v_event.id::text
    order by updated_at desc
    limit 1;

    return jsonb_build_object(
      'success',true,
      'idempotent',true,
      'conversation_id',v_conv.id,
      'assigned_operator',coalesce((select a.name from public.crm_agents a where a.id=v_conv.assigned_to and a.organization_id=v_org),'Fila Geral de Triagem')
    );
  end if;

  v_lock_key:=hashtextextended(
    v_org::text||':crm-recovery:'||coalesce(v_event.buyer_email,'')||':'||coalesce(v_event.transaction_id,v_event.id::text),
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  select *
    into v_agent
  from public.crm_agents
  where organization_id=v_org
    and status='available'
  order by last_assigned_at asc,id asc
  limit 1
  for update skip locked;

  if found then
    v_assigned:=v_agent.id;
    v_name:=v_agent.name;
    update public.crm_agents
       set last_assigned_at=v_now
     where id=v_agent.id;
  end if;

  select *
    into v_conv
  from public.crm_conversations
  where organization_id=v_org
    and (
      (v_event.transaction_id is not null and transaction_id=v_event.transaction_id)
      or
      (v_event.buyer_email is not null and lower(buyer_email)=lower(v_event.buyer_email))
    )
  order by updated_at desc
  limit 1
  for update;

  if not found then
    insert into public.crm_conversations(
      user_id,organization_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,
      status,assigned_to,metadata,public_token,updated_at
    )
    values(
      v_event.user_id,v_org,
      nullif(coalesce(v_event.payload->>'funnel_id',v_event.payload->>'funnelId'),''),
      nullif(coalesce(v_event.payload->>'product_id',v_event.payload->>'productId'),''),
      v_event.transaction_id,v_event.buyer_name,v_event.buyer_email,
      'open',v_assigned,
      jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now,'actor_id',v_actor),
      encode(extensions.gen_random_bytes(32),'hex'),
      v_now
    )
    returning * into v_conv;
  else
    update public.crm_conversations
       set buyer_name=coalesce(v_event.buyer_name,buyer_name),
           buyer_email=coalesce(v_event.buyer_email,buyer_email),
           transaction_id=coalesce(v_event.transaction_id,transaction_id),
           assigned_to=coalesce(v_assigned,assigned_to),
           status='open',
           metadata=coalesce(metadata,'{}'::jsonb)
             ||jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now,'actor_id',v_actor),
           updated_at=v_now
     where id=v_conv.id
       and organization_id=v_org
    returning * into v_conv;
  end if;

  insert into public.crm_messages(
    conversation_id,user_id,organization_id,direction,channel,body,metadata,sender_id,created_at
  )
  values(
    v_conv.id,v_event.user_id,v_org,'inbound','internal',
    case when v_name is null
      then '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead mantido na fila geral.'
      else '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead atribuído ao operador: '||v_name||'.'
    end,
    jsonb_build_object('event_id',v_event.id,'execution','crm_recovery','assigned_agent_id',v_assigned,'actor_id',v_actor),
    v_actor,
    v_now
  );

  update public.crm_webhook_events
     set processed_at=coalesce(processed_at,v_now)
   where id=v_event.id
     and organization_id=v_org;

  return jsonb_build_object(
    'success',true,
    'idempotent',false,
    'conversation_id',v_conv.id,
    'assigned_operator',coalesce(v_name,'Fila Geral de Triagem')
  );
end;
$function$;

revoke all on function public.crm_recovery_execute(uuid) from public, anon;
grant execute on function public.crm_recovery_execute(uuid) to authenticated;
