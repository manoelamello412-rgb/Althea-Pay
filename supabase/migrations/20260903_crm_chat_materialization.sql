alter table public.crm_conversations add column if not exists funnel_id text;
alter table public.crm_conversations add column if not exists product_id text;
alter table public.crm_conversations add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists crm_conversations_user_funnel_updated_idx on public.crm_conversations(user_id,funnel_id,updated_at desc);

create or replace function public.materialize_funnel_chat_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  p jsonb := coalesce(new.payload,'{}'::jsonb);
  c jsonb := coalesce(p->'customer','{}'::jsonb);
  conv uuid;
  email text := nullif(c->>'email','');
begin
  if new.event_type not in ('chat_started','chat_message') then return new; end if;
  select id into conv from public.crm_conversations
   where user_id=new.user_id and funnel_id=new.funnel_id and status='open'
     and coalesce(buyer_email,'')=coalesce(email,'')
   order by updated_at desc limit 1;
  if conv is null then
    insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,metadata)
    values(new.user_id,new.funnel_id,nullif(p->>'product_id',''),nullif(p->>'transaction_id',''),nullif(c->>'name',''),email,'open',p)
    returning id into conv;
  else
    update public.crm_conversations set metadata=p,updated_at=now() where id=conv;
  end if;
  if new.event_type='chat_message' then
    insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata)
    values(conv,new.user_id,'inbound','funnel_chat',coalesce(nullif(p->>'message',''),'[mensagem sem conteúdo]'),p);
  end if;
  return new;
end;
$$;

drop trigger if exists integration_events_materialize_chat on public.integration_events;
create trigger integration_events_materialize_chat
after insert on public.integration_events
for each row execute function public.materialize_funnel_chat_event();

alter table public.crm_conversations replica identity full;
alter table public.crm_messages replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.crm_conversations;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.crm_messages;
exception when duplicate_object then null;
end $$;
