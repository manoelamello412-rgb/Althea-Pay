create or replace function public.materialize_funnel_chat_event() returns trigger language plpgsql security definer set search_path=public as $$
declare p jsonb:=coalesce(new.payload,'{}'::jsonb); c jsonb:=coalesce(p->'customer','{}'::jsonb); conv uuid;
begin
 if new.event_type not in ('chat_started','chat_message') then return new; end if;
 if new.event_type='chat_started' then
   select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and status='open' and coalesce(buyer_email,'')=coalesce(nullif(c->>'email',''),'') order by updated_at desc limit 1;
   if conv is null then
     insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,metadata) values(new.user_id,new.funnel_id,nullif(p->>'product_id',''),nullif(p->>'transaction_id',''),nullif(c->>'name',''),nullif(c->>'email',''),'open',p) returning id into conv;
   else update public.crm_conversations set metadata=p,updated_at=now() where id=conv; end if;
 else
   select id into conv from public.crm_conversations where user_id=new.user_id and funnel_id=new.funnel_id and status='open' and coalesce(buyer_email,'')=coalesce(nullif(c->>'email',''),'') order by updated_at desc limit 1;
   if conv is null then
     insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,metadata) values(new.user_id,new.funnel_id,nullif(p->>'product_id',''),nullif(p->>'transaction_id',''),nullif(c->>'name',''),nullif(c->>'email',''),'open',p) returning id into conv;
   else update public.crm_conversations set metadata=p,updated_at=now() where id=conv; end if;
   insert into public.crm_messages(conversation_id,user_id,direction,channel,body) values(conv,new.user_id,'inbound','funnel_chat',coalesce(nullif(p->>'message',''),nullif(new.payload->>'message',''),'[mensagem sem conteúdo]'));
 end if;
 return new;
end; $$;
drop trigger if exists integration_events_materialize_chat on public.integration_events;
create trigger integration_events_materialize_chat after insert on public.integration_events for each row execute function public.materialize_funnel_chat_event();