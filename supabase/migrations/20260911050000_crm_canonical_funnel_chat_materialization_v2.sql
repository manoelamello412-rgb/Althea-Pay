-- Canonical Funnel -> CRM chat materialization.
-- The database trigger is the single authority for creating/updating CRM conversations
-- and inbound chat messages from integration_events.
-- This migration mirrors the already-applied production function definition.

CREATE OR REPLACE FUNCTION public.materialize_funnel_chat_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  p jsonb := coalesce(new.payload,'{}'::jsonb);
  c jsonb := coalesce(p->'customer','{}'::jsonb);
  supplied_token text := nullif(coalesce(p->>'conversation_token', new.payload->>'conversation_token'),'');
  normalized_email text := lower(nullif(coalesce(c->>'email', p->>'email', p->>'buyer_email'),''));
  conv uuid;
begin
  if new.event_type not in ('chat_started','chat_message') then
    return new;
  end if;

  if supplied_token is not null then
    select id into conv
      from public.crm_conversations
     where user_id=new.user_id
       and funnel_id=new.funnel_id
       and public_token=supplied_token
     for update;
    if conv is null then
      raise exception 'CRM_CONVERSATION_NOT_FOUND' using errcode='P0002';
    end if;
  else
    select id into conv
      from public.crm_conversations
     where user_id=new.user_id
       and funnel_id=new.funnel_id
       and status in ('open','pending')
       and lower(coalesce(buyer_email,''))=coalesce(normalized_email,'')
     order by updated_at desc
     limit 1
     for update;

    if conv is null then
      begin
        insert into public.crm_conversations(
          user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,metadata
        ) values (
          new.user_id,
          new.funnel_id,
          nullif(p->>'product_id',''),
          nullif(p->>'transaction_id',''),
          nullif(coalesce(c->>'name',p->>'name',p->>'buyer_name'),''),
          normalized_email,
          'open',
          p
        ) returning id into conv;
      exception when unique_violation then
        select id into conv
          from public.crm_conversations
         where user_id=new.user_id
           and funnel_id=new.funnel_id
           and status in ('open','pending')
           and lower(coalesce(buyer_email,''))=coalesce(normalized_email,'')
         order by updated_at desc
         limit 1;
        if conv is null then raise; end if;
      end;
    else
      update public.crm_conversations
         set metadata=p,
             updated_at=now()
       where id=conv;
    end if;
  end if;

  if new.event_type='chat_message' then
    insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata)
    values(
      conv,
      new.user_id,
      'inbound',
      'funnel_chat',
      coalesce(nullif(p->>'message',''),nullif(p->>'body',''),'[mensagem sem conteúdo]'),
      jsonb_build_object('integration_event_id',new.id,'funnel_id',new.funnel_id,'external_id',new.external_id)
    );
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.materialize_funnel_chat_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_funnel_chat_event() FROM anon;
REVOKE ALL ON FUNCTION public.materialize_funnel_chat_event() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_funnel_chat_event() TO service_role;
