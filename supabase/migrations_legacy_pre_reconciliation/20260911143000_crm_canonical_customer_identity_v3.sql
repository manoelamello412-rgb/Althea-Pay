-- Canonical Customer identity for Multi-CRM.
-- Prefer clients.id when present; email is fallback only when no canonical client exists.

CREATE INDEX IF NOT EXISTS clients_user_id_id_idx ON public.clients(user_id,id);

-- The canonical materializer and Customer 360 definitions are intentionally kept in this
-- versioned migration. See the immediately-following tag alias correction migration for
-- the final Customer 360 function body used in production.

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
    select cl.id into canonical_customer_id from public.clients cl where cl.user_id=new.user_id and cl.id=supplied_customer_id limit 1;
  end if;
  if canonical_customer_id is null and normalized_email is not null then
    select cl.id into canonical_customer_id from public.clients cl where cl.user_id=new.user_id and lower(coalesce(cl.data->>'email',cl.data->>'buyer_email',cl.data->>'customer_email',''))=normalized_email order by cl.created_at desc limit 1;
  end if;
  if supplied_token is not null then
    select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and public_token=supplied_token for update;
    if conv is null then raise exception 'CRM_CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
  else
    if canonical_customer_id is not null then
      select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and customer_id=canonical_customer_id and status in ('open','pending') order by updated_at desc limit 1 for update;
    end if;
    if conv is null and canonical_customer_id is null and normalized_email is not null then
      select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and status in ('open','pending') and lower(buyer_email)=normalized_email order by updated_at desc limit 1 for update;
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

-- Customer 360 is finalized by the following migration so the repository migration
-- sequence remains readable and the production definition is exactly versioned.
