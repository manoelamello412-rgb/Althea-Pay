-- Canonical Customer identity for Multi-CRM.
-- Prefer clients.id when present; email is fallback only when no canonical client exists.

CREATE INDEX IF NOT EXISTS clients_user_id_id_idx ON public.clients(user_id,id);

CREATE OR REPLACE FUNCTION public.materialize_funnel_chat_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  p jsonb := coalesce(new.payload,'{}'::jsonb);
  c jsonb := coalesce(p->'customer','{}'::jsonb);
  supplied_token text := nullif(coalesce(p->>'conversation_token',new.payload->>'conversation_token'),'');
  normalized_email text := lower(nullif(btrim(coalesce(c->>'email',p->>'email',p->>'buyer_email','')),''));
  supplied_customer_id text := nullif(btrim(coalesce(c->>'customer_id',p->>'customer_id','')),'');
  canonical_customer_id text;
  conv uuid;
begin
  if new.event_type not in ('chat_started','chat_message') then return new; end if;

  if supplied_customer_id is not null then
    select cl.id into canonical_customer_id from public.clients cl
     where cl.user_id=new.user_id and cl.id=supplied_customer_id limit 1;
  end if;
  if canonical_customer_id is null and normalized_email is not null then
    select cl.id into canonical_customer_id from public.clients cl
     where cl.user_id=new.user_id
       and lower(coalesce(cl.data->>'email',cl.data->>'buyer_email',cl.data->>'customer_email',''))=normalized_email
     order by cl.created_at desc limit 1;
  end if;

  if supplied_token is not null then
    select id into conv from public.crm_conversations
     where user_id=new.user_id and funnel_id=new.funnel_id and public_token=supplied_token for update;
    if conv is null then raise exception 'CRM_CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
  else
    if canonical_customer_id is not null then
      select id into conv from public.crm_conversations
       where user_id=new.user_id and funnel_id=new.funnel_id and customer_id=canonical_customer_id and status in ('open','pending')
       order by updated_at desc limit 1 for update;
    end if;
    if conv is null and canonical_customer_id is null and normalized_email is not null then
      select id into conv from public.crm_conversations
       where user_id=new.user_id and funnel_id=new.funnel_id and status in ('open','pending') and lower(buyer_email)=normalized_email
       order by updated_at desc limit 1 for update;
    end if;
    if conv is null then
      begin
        insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,metadata,customer_id)
        values(new.user_id,new.funnel_id,nullif(p->>'product_id',''),nullif(p->>'transaction_id',''),nullif(coalesce(c->>'name',p->>'name',p->>'buyer_name'),''),normalized_email,'open',p,canonical_customer_id)
        returning id into conv;
      exception when unique_violation then
        if canonical_customer_id is not null then
          select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and customer_id=canonical_customer_id and status in ('open','pending') order by updated_at desc limit 1;
        elsif normalized_email is not null then
          select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and status in ('open','pending') and lower(buyer_email)=normalized_email order by updated_at desc limit 1;
        end if;
        if conv is null then raise; end if;
      end;
    else
      update public.crm_conversations set metadata=p, customer_id=coalesce(customer_id,canonical_customer_id), updated_at=now() where id=conv;
    end if;
  end if;

  if new.event_type='chat_message' then
    insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,provider,external_message_id)
    values(conv,new.user_id,'inbound','funnel_chat',coalesce(nullif(p->>'message',''),nullif(p->>'body',''),'[mensagem sem conteúdo]'),jsonb_build_object('integration_event_id',new.id,'funnel_id',new.funnel_id,'external_id',new.external_id),'althea_funnel',nullif(new.external_id,''))
    on conflict (user_id,provider,external_message_id) where external_message_id is not null do nothing;
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.materialize_funnel_chat_event() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_funnel_chat_event() TO service_role;

CREATE OR REPLACE FUNCTION public.crm_customer_360(p_conversation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
declare v_user uuid:=auth.uid(); v jsonb;
begin
 if v_user is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
 if not exists(select 1 from public.crm_conversations c where c.id=p_conversation_id and c.user_id=v_user) then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
 with base as (select c.*,cl.id as canonical_customer_id,cl.data as canonical_customer_data,lower(nullif(trim(coalesce(cl.data->>'email',cl.data->>'buyer_email',cl.data->>'customer_email',c.buyer_email)),'')) as email_key from public.crm_conversations c left join public.clients cl on cl.user_id=c.user_id and cl.id=c.customer_id where c.id=p_conversation_id and c.user_id=v_user),
 related_conversations as (select c.* from public.crm_conversations c,base b where c.user_id=v_user and ((b.canonical_customer_id is not null and c.customer_id=b.canonical_customer_id) or (b.canonical_customer_id is null and b.email_key is not null and lower(c.buyer_email)=b.email_key))),
 related_sales as (select distinct s.* from public.sales s,base b where s.user_id=v_user and ((b.canonical_customer_id is not null and coalesce(s.data->>'customer_id','')=b.canonical_customer_id) or (b.canonical_customer_id is null and b.email_key is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=b.email_key) or (b.transaction_id is not null and s.transaction_id::text=b.transaction_id))),
 related_checkouts as (select cs.* from public.checkout_sessions cs,base b where cs.user_id=v_user and b.email_key is not null and lower(coalesce(cs.customer->>'email',cs.customer->>'buyer_email',''))=b.email_key),
 related_attempts as (select a.* from public.gateway_payment_attempts a join related_sales s on s.id=a.sale_id and a.user_id=v_user),
 related_events as (select e.* from public.crm_webhook_events e,base b where e.user_id=v_user and ((b.transaction_id is not null and e.transaction_id=b.transaction_id) or (b.canonical_customer_id is null and b.email_key is not null and lower(e.buyer_email)=b.email_key))),
 approved_sales as (select * from related_sales where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded')),
 message_window as (select m.* from public.crm_messages m join related_conversations c on c.id=m.conversation_id where m.user_id=v_user order by m.created_at desc limit 500),
 aggregates as (select (select count(*)::int from related_conversations) conversations,(select count(*)::int from related_conversations where unread_count>0) unread,(select count(*)::int from related_sales) sales_count,(select count(*)::int from approved_sales) approved_sales_count,(select coalesce(sum(amount),0)::numeric from approved_sales) approved_revenue,(select coalesce(sum(amount),0)::numeric from related_sales) gross_tracked_value,(select count(*)::int from related_checkouts) checkout_count,(select count(*)::int from related_checkouts where status='completed') completed_checkouts,(select count(*)::int from related_checkouts where status in ('abandoned','expired')) abandoned_checkouts,(select count(*)::int from related_attempts) payment_attempts,(select count(*)::int from related_attempts where lower(coalesce(status,'')) in ('approved','paid','completed','success','succeeded')) approved_attempts,(select count(*)::int from related_events) event_count,(select count(*)::int from related_events where lower(coalesce(status,'')) in ('failed','declined','rejected','refused','error','canceled','cancelled','expired')) failed_events,(select count(*)::int from related_events where lower(coalesce(status,'')) in ('pending','waiting','processing','awaiting_payment')) pending_events,(select count(*)::int from message_window where direction='inbound') inbound_messages,(select count(*)::int from message_window where direction='outbound') outbound_messages,(select count(*)::int from public.crm_conversation_notes n join related_conversations c on c.id=n.conversation_id where n.user_id=v_user) notes_count,(select count(*)::int from public.crm_conversation_tags t join related_conversations c on c.id=t.conversation_id where t.user_id=v_user) tag_count),
 scores as (select least(100,greatest(0,case when a.approved_sales_count>0 then 45 else 0 end+least(25,a.inbound_messages*2)+least(20,a.completed_checkouts*8)+case when a.unread>0 then 10 else 0 end))::int engagement_score,least(100,greatest(0,case when a.approved_sales_count>0 then 55 else 0 end+least(25,a.completed_checkouts*8)+least(20,a.approved_attempts*5)))::int conversion_score,least(100,greatest(0,case when a.abandoned_checkouts>0 then 35 else 0 end+least(25,a.pending_events*5)+least(25,a.failed_events*4)+case when a.unread>0 then 15 else 0 end))::int recovery_score from aggregates a)
 select jsonb_build_object('profile',(select jsonb_build_object('conversation',to_jsonb(b)-'canonical_customer_data','customer',case when b.canonical_customer_id is not null then jsonb_build_object('id',b.canonical_customer_id,'data',b.canonical_customer_data) else null end) from base b),'conversations',coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at desc) from related_conversations c),'[]'::jsonb),'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from message_window m),'[]'::jsonb),'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from public.crm_conversation_notes n join related_conversations c on c.id=n.conversation_id where n.user_id=v_user),'[]'::jsonb),'tags',coalesce((select jsonb_agg(to_jsonb(t) order by t.tag asc) from public.crm_conversation_tags t join related_conversations c on c.id=t.conversation_id where n.user_id=v_user),'[]'::jsonb),'sales',coalesce((select jsonb_agg(to_jsonb(s) order by coalesce(s.occurred_at,s.created_at) desc) from related_sales s),'[]'::jsonb),'checkouts',coalesce((select jsonb_agg(to_jsonb(cs) order by cs.created_at desc) from related_checkouts cs),'[]'::jsonb),'payment_attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from related_attempts a),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.received_at desc) from related_events e),'[]'::jsonb),'aggregates',(select to_jsonb(a) from aggregates a),'scores',(select to_jsonb(s) from scores s),'generated_at',timezone('utc',now())) into v;
 return v;
end;
$function$;
REVOKE ALL ON FUNCTION public.crm_customer_360(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_customer_360(uuid) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_user_provider_external_id_uq ON public.crm_messages(user_id,provider,external_message_id) WHERE external_message_id IS NOT NULL;
