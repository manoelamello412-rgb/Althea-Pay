create or replace function public.crm_recovery_execute(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
 v_user uuid:=auth.uid();
 v_event public.crm_webhook_events%rowtype;
 v_agent public.crm_agents%rowtype;
 v_conv public.crm_conversations%rowtype;
 v_now timestamptz:=clock_timestamp();
 v_lock_key bigint;
 v_token text;
 v_assigned uuid;
 v_name text;
begin
 if v_user is null then raise exception 'unauthorized'; end if;
 select * into v_event from public.crm_webhook_events where id=p_event_id and user_id=v_user for update;
 if not found then raise exception 'event_not_found'; end if;

 if v_event.processed_at is not null then
   select * into v_conv
   from public.crm_conversations
   where user_id=v_user
     and metadata->>'recovery_event_id'=v_event.id::text
   order by updated_at desc
   limit 1;
   return jsonb_build_object(
     'success',true,
     'idempotent',true,
     'conversation_id',v_conv.id,
     'conversation_token',v_conv.public_token,
     'assigned_operator',coalesce((select a.name from public.crm_agents a where a.id=v_conv.assigned_to),'Fila Geral de Triagem')
   );
 end if;

 v_lock_key:=hashtextextended(v_user::text||':crm-recovery:'||coalesce(v_event.buyer_email,'')||':'||coalesce(v_event.transaction_id,v_event.id::text),0);
 perform pg_advisory_xact_lock(v_lock_key);

 select * into v_agent from public.crm_agents where user_id=v_user and status='available' order by last_assigned_at asc,id asc limit 1 for update skip locked;
 if found then v_assigned:=v_agent.id; v_name:=v_agent.name; update public.crm_agents set last_assigned_at=v_now where id=v_agent.id; end if;
 select * into v_conv from public.crm_conversations where user_id=v_user and ((v_event.transaction_id is not null and transaction_id=v_event.transaction_id) or (v_event.buyer_email is not null and lower(buyer_email)=lower(v_event.buyer_email))) order by updated_at desc limit 1 for update;
 if not found then
  v_token:=encode(gen_random_bytes(32),'hex');
  insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,assigned_to,metadata,public_token,updated_at)
  values(v_user,nullif(coalesce(v_event.payload->>'funnel_id',v_event.payload->>'funnelId'),''),nullif(coalesce(v_event.payload->>'product_id',v_event.payload->>'productId'),''),v_event.transaction_id,v_event.buyer_name,v_event.buyer_email,'open',v_assigned,jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now),v_token,v_now)
  returning * into v_conv;
 else
  update public.crm_conversations set buyer_name=coalesce(v_event.buyer_name,buyer_name),buyer_email=coalesce(v_event.buyer_email,buyer_email),transaction_id=coalesce(v_event.transaction_id,transaction_id),assigned_to=coalesce(v_assigned,assigned_to),status='open',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now),updated_at=v_now where id=v_conv.id returning * into v_conv;
  v_token:=v_conv.public_token;
 end if;
 insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at) values(v_conv.id,v_user,'inbound','system',case when v_name is null then '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead mantido na fila geral.' else '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead atribuído ao operador: '||v_name||'.' end,jsonb_build_object('event_id',v_event.id,'execution','crm_recovery','assigned_agent_id',v_assigned),v_now);
 update public.crm_webhook_events set processed_at=coalesce(processed_at,v_now) where id=v_event.id;
 return jsonb_build_object('success',true,'idempotent',false,'conversation_id',v_conv.id,'conversation_token',v_token,'assigned_operator',coalesce(v_name,'Fila Geral de Triagem'));
end;
$$;
revoke all on function public.crm_recovery_execute(uuid) from public, anon;
grant execute on function public.crm_recovery_execute(uuid) to authenticated;