-- Funnel leads become customers.
-- Before: only approved payments, chat and channel messages resolved a customer, so a lead who left
-- name/email/phone in the funnel (and an unpaid PIX) existed only as a chat conversation, never in
-- Clientes or the Kanban. Now any funnel event carrying an email or phone resolves the customer
-- (clients_enter_default_pipeline then drops it on the default pipeline) and links the funnel's
-- open conversations for that email.

create or replace function private.materialize_funnel_lead_customer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  p jsonb := coalesce(new.payload,'{}'::jsonb);
  c jsonb := case when jsonb_typeof(p->'customer')='object' then p->'customer' else '{}'::jsonb end;
  v_email text := lower(nullif(btrim(coalesce(c->>'email',p->>'email',p->>'buyer_email','')),''));
  v_phone text := nullif(btrim(coalesce(c->>'phone',c->>'whatsapp',p->>'phone',p->>'whatsapp',p->>'customer_whatsapp','')),'');
  v_client text;
begin
  -- Chat events resolve their own customer in materialize_funnel_chat_event.
  if new.event_type in ('chat_started','chat_message') or new.organization_id is null or new.user_id is null
     or (v_email is null and v_phone is null) then
    return new;
  end if;

  v_client := private.resolve_customer(
    new.organization_id,new.user_id,v_email,v_phone,coalesce(new.visitor_id,p->>'visitor_id'),null,
    jsonb_strip_nulls(jsonb_build_object('name',nullif(btrim(coalesce(c->>'name',p->>'name',p->>'buyer_name','')),''),'source_funnel_id',new.funnel_id)));

  if v_client is not null and v_email is not null then
    update public.crm_conversations
       set customer_id=v_client
     where user_id=new.user_id and funnel_id=new.funnel_id and customer_id is null
       and status in ('open','pending') and lower(buyer_email)=v_email;
  end if;
  return new;
exception when others then
  -- Never lose the funnel event over a customer projection failure.
  raise warning 'funnel_lead_customer_failed event=% sqlstate=% %', new.id, sqlstate, sqlerrm;
  return new;
end;
$function$;
revoke all on function private.materialize_funnel_lead_customer() from public, anon, authenticated;

drop trigger if exists integration_events_materialize_lead_customer on public.integration_events;
create trigger integration_events_materialize_lead_customer
after insert on public.integration_events
for each row execute function private.materialize_funnel_lead_customer();

-- Chat: a contact already resolved to a customer whose open conversation was created without
-- customer_id (checkout, older events) was never matched by email and the insert hit
-- crm_conversations_active_email_per_funnel_uq. Email is now always a fallback.
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

  canonical_customer_id := private.resolve_customer(
    new.organization_id,new.user_id,normalized_email,
    coalesce(c->>'phone',c->>'whatsapp',p->>'phone',p->>'whatsapp',p->>'customer_whatsapp'),
    coalesce(new.visitor_id,p->>'visitor_id'),supplied_customer_id,
    jsonb_strip_nulls(jsonb_build_object('name',nullif(coalesce(c->>'name',p->>'name',p->>'buyer_name'),''))));

  if supplied_token is not null then
    select id into conv from public.crm_conversations
     where user_id=new.user_id and funnel_id=new.funnel_id and public_token=supplied_token
     for update;
    if conv is null then raise exception 'CRM_CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
  else
    if canonical_customer_id is not null then
      select id into conv from public.crm_conversations
       where user_id=new.user_id and funnel_id=new.funnel_id
         and customer_id=canonical_customer_id and status in ('open','pending')
       order by updated_at desc limit 1 for update;
    end if;
    if conv is null and normalized_email is not null then
      select id into conv from public.crm_conversations
       where user_id=new.user_id and funnel_id=new.funnel_id
         and status in ('open','pending') and lower(buyer_email)=normalized_email
       order by updated_at desc limit 1 for update;
    end if;
    if conv is null then
      begin
        insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,metadata,customer_id)
        values(new.user_id,new.funnel_id,nullif(p->>'product_id',''),nullif(p->>'transaction_id',''),
          nullif(coalesce(c->>'name',p->>'name',p->>'buyer_name'),''),normalized_email,'open',p,canonical_customer_id)
        returning id into conv;
      exception when unique_violation then
        if canonical_customer_id is not null then
          select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and customer_id=canonical_customer_id and status in ('open','pending') order by updated_at desc limit 1;
        end if;
        if conv is null and normalized_email is not null then
          select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and status in ('open','pending') and lower(buyer_email)=normalized_email order by updated_at desc limit 1;
        end if;
        if conv is null then raise; end if;
      end;
    else
      update public.crm_conversations
         set metadata=p, customer_id=coalesce(customer_id,canonical_customer_id), updated_at=now()
       where id=conv;
    end if;
  end if;

  if new.event_type='chat_message' then
    insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,provider,external_message_id)
    values(conv,new.user_id,'inbound','funnel_chat',coalesce(nullif(p->>'message',''),nullif(p->>'body',''),'[mensagem sem conteúdo]'),
      jsonb_build_object('integration_event_id',new.id,'funnel_id',new.funnel_id,'external_id',new.external_id),
      'althea_funnel',nullif(new.external_id,''))
    on conflict (user_id,provider,external_message_id) where external_message_id is not null do nothing;
  end if;
  return new;
end;
$function$;

-- Backfill leads already captured, oldest first so the first identity owner keeps it.
do $backfill$
declare e record;
begin
  for e in
    select ie.* from public.integration_events ie
     where ie.event_type not in ('chat_started','chat_message')
       and ie.organization_id is not null and ie.funnel_id is not null
       and coalesce(ie.payload->'customer'->>'email',ie.payload->>'email',ie.payload->>'buyer_email',
                    ie.payload->'customer'->>'phone',ie.payload->>'phone') is not null
     order by ie.created_at
  loop
    perform private.resolve_customer(
      e.organization_id,e.user_id,
      coalesce(e.payload->'customer'->>'email',e.payload->>'email',e.payload->>'buyer_email'),
      coalesce(e.payload->'customer'->>'phone',e.payload->>'phone'),
      e.visitor_id,null,
      jsonb_strip_nulls(jsonb_build_object('name',coalesce(e.payload->'customer'->>'name',e.payload->>'name'),'source_funnel_id',e.funnel_id)));
  end loop;
end
$backfill$;

update public.crm_conversations cv
   set customer_id=ci.client_id
  from public.funnels f, public.customer_identities ci
 where cv.customer_id is null and cv.buyer_email is not null and cv.status in ('open','pending')
   and f.id=cv.funnel_id and ci.organization_id=f.organization_id and ci.user_id=cv.user_id
   and ci.kind='email' and ci.value=private.normalize_customer_identity('email',cv.buyer_email);
