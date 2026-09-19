set local lock_timeout='3s'; set local statement_timeout='30s';
DO $guard$ BEGIN IF pg_get_functiondef('public.acquire_gateway_circuit(uuid,uuid,text,integer,integer,integer)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.acquire_gateway_circuit(p_user_id uuid, p_gateway_id uuid, p_gateway_name text, p_failure_threshold integer DEFAULT 3, p_cooldown_seconds integer DEFAULT 30, p_probe_lease_seconds integer DEFAULT 5)
 RETURNS TABLE(allowed boolean, circuit_state text, failure_count integer, probe_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row public.gateway_circuit_states; v_key BIGINT; v_probe TEXT;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_user_id IS NULL OR p_gateway_id IS NULL THEN RAISE EXCEPTION 'circuit_identity_required'; END IF;
 IF p_failure_threshold < 1 OR p_cooldown_seconds < 1 OR p_probe_lease_seconds < 1 THEN RAISE EXCEPTION 'circuit_parameters_invalid'; END IF;
 v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text, 0); PERFORM pg_advisory_xact_lock(v_key);
 INSERT INTO public.gateway_circuit_states(user_id,gateway_id,gateway_name) VALUES(p_user_id,p_gateway_id,lower(trim(coalesce(p_gateway_name,p_gateway_id::text)))) ON CONFLICT (user_id,gateway_id) DO NOTHING;
 SELECT * INTO v_row FROM public.gateway_circuit_states WHERE user_id=p_user_id AND gateway_id=p_gateway_id FOR UPDATE;
 IF v_row.circuit_state='open' THEN
   IF v_row.opened_at IS NOT NULL AND v_row.opened_at > timezone('utc',now())-make_interval(secs=>p_cooldown_seconds) THEN RETURN QUERY SELECT false,'open'::text,v_row.failure_count,NULL::text; RETURN; END IF;
   IF v_row.probe_until IS NOT NULL AND v_row.probe_until > timezone('utc',now()) THEN RETURN QUERY SELECT false,'half_open'::text,v_row.failure_count,NULL::text; RETURN; END IF;
   v_probe := encode(gen_random_bytes(16),'hex');
   UPDATE public.gateway_circuit_states SET circuit_state='half_open',probe_until=timezone('utc',now())+make_interval(secs=>p_probe_lease_seconds),updated_at=timezone('utc',now()),version=version+1 WHERE user_id=p_user_id AND gateway_id=p_gateway_id;
   RETURN QUERY SELECT true,'half_open'::text,v_row.failure_count,v_probe; RETURN;
 END IF;
 IF v_row.circuit_state='half_open' THEN
   IF v_row.probe_until IS NULL OR v_row.probe_until <= timezone('utc',now()) THEN
     v_probe := encode(gen_random_bytes(16),'hex');
     UPDATE public.gateway_circuit_states SET probe_until=timezone('utc',now())+make_interval(secs=>p_probe_lease_seconds),updated_at=timezone('utc',now()),version=version+1 WHERE user_id=p_user_id AND gateway_id=p_gateway_id;
     RETURN QUERY SELECT true,'half_open'::text,v_row.failure_count,v_probe; RETURN;
   END IF;
   RETURN QUERY SELECT false,'half_open'::text,v_row.failure_count,NULL::text; RETURN;
 END IF;
 RETURN QUERY SELECT true,'closed'::text,v_row.failure_count,NULL::text;
END; $function$
$old$ THEN RAISE EXCEPTION 'Function changed since inspection'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.acquire_gateway_circuit(p_user_id uuid, p_gateway_id uuid, p_gateway_name text, p_failure_threshold integer DEFAULT 3, p_cooldown_seconds integer DEFAULT 30, p_probe_lease_seconds integer DEFAULT 5)
 RETURNS TABLE(allowed boolean, circuit_state text, failure_count integer, probe_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_row public.gateway_circuit_states; v_key BIGINT; v_probe TEXT;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_user_id IS NULL OR p_gateway_id IS NULL THEN RAISE EXCEPTION 'circuit_identity_required'; END IF;
 IF p_failure_threshold < 1 OR p_cooldown_seconds < 1 OR p_probe_lease_seconds < 1 THEN RAISE EXCEPTION 'circuit_parameters_invalid'; END IF;
 v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text, 0); PERFORM pg_advisory_xact_lock(v_key);
 INSERT INTO public.gateway_circuit_states(user_id,gateway_id,gateway_name) VALUES(p_user_id,p_gateway_id,lower(trim(coalesce(p_gateway_name,p_gateway_id::text)))) ON CONFLICT (user_id,gateway_id) DO NOTHING;
 SELECT * INTO v_row FROM public.gateway_circuit_states WHERE user_id=p_user_id AND gateway_id=p_gateway_id FOR UPDATE;
 IF v_row.circuit_state='open' THEN
   IF v_row.opened_at IS NOT NULL AND v_row.opened_at > timezone('utc',now())-make_interval(secs=>p_cooldown_seconds) THEN RETURN QUERY SELECT false,'open'::text,v_row.failure_count,NULL::text; RETURN; END IF;
   IF v_row.probe_until IS NOT NULL AND v_row.probe_until > timezone('utc',now()) THEN RETURN QUERY SELECT false,'half_open'::text,v_row.failure_count,NULL::text; RETURN; END IF;
   v_probe := encode(extensions.gen_random_bytes(16),'hex');
   UPDATE public.gateway_circuit_states SET circuit_state='half_open',probe_until=timezone('utc',now())+make_interval(secs=>p_probe_lease_seconds),updated_at=timezone('utc',now()),version=version+1 WHERE user_id=p_user_id AND gateway_id=p_gateway_id;
   RETURN QUERY SELECT true,'half_open'::text,v_row.failure_count,v_probe; RETURN;
 END IF;
 IF v_row.circuit_state='half_open' THEN
   IF v_row.probe_until IS NULL OR v_row.probe_until <= timezone('utc',now()) THEN
     v_probe := encode(extensions.gen_random_bytes(16),'hex');
     UPDATE public.gateway_circuit_states SET probe_until=timezone('utc',now())+make_interval(secs=>p_probe_lease_seconds),updated_at=timezone('utc',now()),version=version+1 WHERE user_id=p_user_id AND gateway_id=p_gateway_id;
     RETURN QUERY SELECT true,'half_open'::text,v_row.failure_count,v_probe; RETURN;
   END IF;
   RETURN QUERY SELECT false,'half_open'::text,v_row.failure_count,NULL::text; RETURN;
 END IF;
 RETURN QUERY SELECT true,'closed'::text,v_row.failure_count,NULL::text;
END; $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_operator_send_message(uuid,text,text)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_operator_send_message(p_conversation_id uuid, p_body text, p_client_message_id text DEFAULT NULL::text)
 RETURNS crm_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user_id uuid:=auth.uid(); v_body text:=btrim(coalesce(p_body,'')); c public.crm_conversations%rowtype; a public.crm_channel_accounts%rowtype; v_message public.crm_messages; outbox_id uuid; idem text; client_id text:=nullif(trim(p_client_message_id),'');
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if v_body='' then raise exception 'MESSAGE_EMPTY' using errcode='22023'; end if;
 if length(v_body)>10000 then raise exception 'MESSAGE_TOO_LONG' using errcode='22001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 select * into c from public.crm_conversations where id=p_conversation_id and user_id=v_user_id for update;
 if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
 if client_id is null then client_id:='operator:'||c.id::text||':'||encode(digest(v_body||now()::text,'sha256'),'hex'); end if;
 select * into v_message from public.crm_messages where user_id=v_user_id and client_message_id=client_id limit 1;
 if found then return v_message; end if;

 if coalesce(c.primary_channel,'funnel_chat')='funnel_chat' then
   idem:='operator:'||c.id::text||':'||client_id;
   insert into public.crm_channel_message_outbox(user_id,conversation_id,channel_account_id,channel,external_message_id,idempotency_key,direction,body,status,max_attempts,next_attempt_at,metadata)
   values(v_user_id,c.id,null,'funnel_chat',null,idem,'outbound',v_body,'queued',5,now(),jsonb_build_object('source','crm_operator','client_message_id',client_id))
   on conflict(user_id,idempotency_key) do update set updated_at=now()
   returning id into outbox_id;
   insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id)
   values(c.id,v_user_id,'outbound','funnel_chat',v_body,jsonb_build_object('source','crm_operator','outbox_id',outbox_id,'delivery_status','queued'),v_user_id,client_id)
   on conflict(user_id,client_message_id) where client_message_id is not null do nothing
   returning * into v_message;
   if v_message.id is null then select * into v_message from public.crm_messages where user_id=v_user_id and client_message_id=client_id limit 1; end if;
   return v_message;
 end if;

 if c.channel_account_id is null or c.channel_account_id='' then raise exception 'CHANNEL_ACCOUNT_REQUIRED'; end if;
 select * into a from public.crm_channel_accounts where id=c.channel_account_id::uuid and user_id=v_user_id and channel=c.primary_channel and status='active' for update;
 if not found then raise exception 'CHANNEL_ACCOUNT_NOT_FOUND_OR_INACTIVE'; end if;
 idem:='operator:'||c.id::text||':'||client_id;
 insert into public.crm_channel_message_outbox(user_id,conversation_id,channel_account_id,channel,external_message_id,idempotency_key,direction,body,status,max_attempts,next_attempt_at,metadata)
 values(v_user_id,c.id,a.id,c.primary_channel,null,idem,'outbound',v_body,'queued',5,now(),jsonb_build_object('source','crm_operator','client_message_id',client_id))
 on conflict(user_id,idempotency_key) do update set updated_at=now()
 returning id into outbox_id;
 insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id,provider,channel_account_id)
 values(c.id,v_user_id,'outbound',c.primary_channel,v_body,jsonb_build_object('source','crm_operator','outbox_id',outbox_id,'delivery_status','queued'),v_user_id,client_id,a.provider,a.id::text)
 on conflict(user_id,client_message_id) where client_message_id is not null do nothing
 returning * into v_message;
 if v_message.id is null then select * into v_message from public.crm_messages where user_id=v_user_id and client_message_id=client_id limit 1; end if;
 return v_message;
end;$function$
$old$ THEN RAISE EXCEPTION 'Function changed since inspection'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_operator_send_message(p_conversation_id uuid, p_body text, p_client_message_id text DEFAULT NULL::text)
 RETURNS crm_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user_id uuid:=auth.uid(); v_body text:=btrim(coalesce(p_body,'')); c public.crm_conversations%rowtype; a public.crm_channel_accounts%rowtype; v_message public.crm_messages; outbox_id uuid; idem text; client_id text:=nullif(trim(p_client_message_id),'');
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if v_body='' then raise exception 'MESSAGE_EMPTY' using errcode='22023'; end if;
 if length(v_body)>10000 then raise exception 'MESSAGE_TOO_LONG' using errcode='22001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 select * into c from public.crm_conversations where id=p_conversation_id and user_id=v_user_id for update;
 if not found then raise exception 'CONVERSATION_NOT_FOUND' using errcode='P0002'; end if;
 if client_id is null then client_id:='operator:'||c.id::text||':'||encode(extensions.digest(v_body||now()::text,'sha256'),'hex'); end if;
 select * into v_message from public.crm_messages where user_id=v_user_id and client_message_id=client_id limit 1;
 if found then return v_message; end if;

 if coalesce(c.primary_channel,'funnel_chat')='funnel_chat' then
   idem:='operator:'||c.id::text||':'||client_id;
   insert into public.crm_channel_message_outbox(user_id,conversation_id,channel_account_id,channel,external_message_id,idempotency_key,direction,body,status,max_attempts,next_attempt_at,metadata)
   values(v_user_id,c.id,null,'funnel_chat',null,idem,'outbound',v_body,'queued',5,now(),jsonb_build_object('source','crm_operator','client_message_id',client_id))
   on conflict(user_id,idempotency_key) do update set updated_at=now()
   returning id into outbox_id;
   insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id)
   values(c.id,v_user_id,'outbound','funnel_chat',v_body,jsonb_build_object('source','crm_operator','outbox_id',outbox_id,'delivery_status','queued'),v_user_id,client_id)
   on conflict(user_id,client_message_id) where client_message_id is not null do nothing
   returning * into v_message;
   if v_message.id is null then select * into v_message from public.crm_messages where user_id=v_user_id and client_message_id=client_id limit 1; end if;
   return v_message;
 end if;

 if c.channel_account_id is null or c.channel_account_id='' then raise exception 'CHANNEL_ACCOUNT_REQUIRED'; end if;
 select * into a from public.crm_channel_accounts where id=c.channel_account_id::uuid and user_id=v_user_id and channel=c.primary_channel and status='active' for update;
 if not found then raise exception 'CHANNEL_ACCOUNT_NOT_FOUND_OR_INACTIVE'; end if;
 idem:='operator:'||c.id::text||':'||client_id;
 insert into public.crm_channel_message_outbox(user_id,conversation_id,channel_account_id,channel,external_message_id,idempotency_key,direction,body,status,max_attempts,next_attempt_at,metadata)
 values(v_user_id,c.id,a.id,c.primary_channel,null,idem,'outbound',v_body,'queued',5,now(),jsonb_build_object('source','crm_operator','client_message_id',client_id))
 on conflict(user_id,idempotency_key) do update set updated_at=now()
 returning id into outbox_id;
 insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,sender_id,client_message_id,provider,channel_account_id)
 values(c.id,v_user_id,'outbound',c.primary_channel,v_body,jsonb_build_object('source','crm_operator','outbox_id',outbox_id,'delivery_status','queued'),v_user_id,client_id,a.provider,a.id::text)
 on conflict(user_id,client_message_id) where client_message_id is not null do nothing
 returning * into v_message;
 if v_message.id is null then select * into v_message from public.crm_messages where user_id=v_user_id and client_message_id=client_id limit 1; end if;
 return v_message;
end;$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_public_conversation(text)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_public_conversation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare c jsonb; m jsonb; begin if p_token is null or length(p_token)<32 or length(p_token)>128 then return jsonb_build_object('error','invalid_token'); end if; select jsonb_build_object('id',x.id,'funnel_id',x.funnel_id,'product_id',x.product_id,'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'status',x.status,'updated_at',x.updated_at) into c from public.crm_conversations x where x.public_token=p_token limit 1; if c is null then return jsonb_build_object('error','not_found'); end if; select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'direction',q.direction,'channel',q.channel,'body',q.body,'created_at',q.created_at) order by q.created_at asc),'[]'::jsonb) into m from (select x.id,x.direction,x.channel,x.body,x.created_at from public.crm_messages x join public.crm_conversations c2 on c2.id=x.conversation_id where c2.public_token=p_token order by x.created_at desc limit 200) q; return jsonb_build_object('conversation',c,'messages',coalesce(m,'[]'::jsonb)); end; $function$
$old$ THEN RAISE EXCEPTION 'Function changed since inspection'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_public_conversation(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare c jsonb; m jsonb; begin if p_token is null or length(p_token)<32 or length(p_token)>128 then return jsonb_build_object('error','invalid_token'); end if; select jsonb_build_object('id',x.id,'funnel_id',x.funnel_id,'product_id',x.product_id,'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'status',x.status,'updated_at',x.updated_at) into c from public.crm_conversations x where x.public_token=p_token limit 1; if c is null then return jsonb_build_object('error','not_found'); end if; select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'direction',q.direction,'channel',q.channel,'body',q.body,'created_at',q.created_at) order by q.created_at asc),'[]'::jsonb) into m from (select x.id,x.direction,x.channel,x.body,x.created_at from public.crm_messages x join public.crm_conversations c2 on c2.id=x.conversation_id where c2.public_token=p_token and x.channel <> 'internal' order by x.created_at desc limit 200) q; return jsonb_build_object('conversation',c,'messages',coalesce(m,'[]'::jsonb)); end; $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_recovery_execute(uuid)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_recovery_execute(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at) values(v_conv.id,v_user,'inbound','internal',case when v_name is null then '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead mantido na fila geral.' else '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead atribuído ao operador: '||v_name||'.' end,jsonb_build_object('event_id',v_event.id,'execution','crm_recovery','assigned_agent_id',v_assigned),v_now);
 update public.crm_webhook_events set processed_at=coalesce(processed_at,v_now) where id=v_event.id;
 return jsonb_build_object('success',true,'idempotent',false,'conversation_id',v_conv.id,'conversation_token',v_token,'assigned_operator',coalesce(v_name,'Fila Geral de Triagem'));
end;
$function$
$old$ THEN RAISE EXCEPTION 'Function changed since inspection'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_recovery_execute(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.crm_conversations(user_id,funnel_id,product_id,transaction_id,buyer_name,buyer_email,status,assigned_to,metadata,public_token,updated_at)
  values(v_user,nullif(coalesce(v_event.payload->>'funnel_id',v_event.payload->>'funnelId'),''),nullif(coalesce(v_event.payload->>'product_id',v_event.payload->>'productId'),''),v_event.transaction_id,v_event.buyer_name,v_event.buyer_email,'open',v_assigned,jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now),v_token,v_now)
  returning * into v_conv;
 else
  update public.crm_conversations set buyer_name=coalesce(v_event.buyer_name,buyer_name),buyer_email=coalesce(v_event.buyer_email,buyer_email),transaction_id=coalesce(v_event.transaction_id,transaction_id),assigned_to=coalesce(v_assigned,assigned_to),status='open',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('recovery_event_id',v_event.id,'recovery_triggered_at',v_now),updated_at=v_now where id=v_conv.id returning * into v_conv;
  v_token:=v_conv.public_token;
 end if;
 insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at) values(v_conv.id,v_user,'inbound','internal',case when v_name is null then '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead mantido na fila geral.' else '[SISTEMA ALTHEA PAY] Recuperação acionada. Lead atribuído ao operador: '||v_name||'.' end,jsonb_build_object('event_id',v_event.id,'execution','crm_recovery','assigned_agent_id',v_assigned),v_now);
 update public.crm_webhook_events set processed_at=coalesce(processed_at,v_now) where id=v_event.id;
 return jsonb_build_object('success',true,'idempotent',false,'conversation_id',v_conv.id,'conversation_token',v_token,'assigned_operator',coalesce(v_name,'Fila Geral de Triagem'));
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_sync_webhook_event()'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_sync_webhook_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_type text:=lower(coalesce(new.payload->>'event_type',''));
  v_funnel_id text:=coalesce(new.payload->>'funnel_id',new.payload->>'funnelId');
  v_product_id text:=coalesce(new.payload->>'product_id',new.payload->>'productId');
  v_conversation_id uuid;
  v_token text;
begin
  if v_event_type in ('chat_started','chat_message') then
    new.processed_at:=timezone('utc',now());
    return new;
  end if;
  if new.transaction_id is null and new.buyer_email is null then return new; end if;

  select id into v_conversation_id from public.crm_conversations
   where user_id=new.user_id
     and ((new.transaction_id is not null and transaction_id=new.transaction_id)
       or (new.buyer_email is not null and lower(buyer_email)=lower(new.buyer_email)))
   order by updated_at desc limit 1;

  if v_conversation_id is null then
    v_token:=encode(gen_random_bytes(24),'hex');
    insert into public.crm_conversations(user_id,buyer_email,buyer_name,transaction_id,funnel_id,product_id,status,metadata,public_token,last_message_at)
    values(new.user_id,new.buyer_email,new.buyer_name,new.transaction_id,v_funnel_id,v_product_id,'open',jsonb_build_object('created_from','webhook','webhook_event_id',new.id),v_token,new.received_at)
    returning id into v_conversation_id;
  else
    update public.crm_conversations set buyer_email=coalesce(new.buyer_email,buyer_email),buyer_name=coalesce(new.buyer_name,buyer_name),transaction_id=coalesce(new.transaction_id,transaction_id),funnel_id=coalesce(v_funnel_id,funnel_id),product_id=coalesce(v_product_id,product_id),updated_at=timezone('utc',now()),metadata=metadata||jsonb_build_object('last_webhook_event_id',new.id) where id=v_conversation_id;
  end if;

  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at,provider)
  values(v_conversation_id,new.user_id,'inbound','internal',concat('Evento recebido: ',new.status,case when new.error_reason is not null then concat(' — ',new.error_reason) else '' end),jsonb_build_object('webhook_event_id',new.id,'transaction_id',new.transaction_id,'status',new.status,'source','crm_webhook_event'),new.received_at,'internal');

  new.processed_at:=timezone('utc',now());
  return new;
end;
$function$
$old$ THEN RAISE EXCEPTION 'Function changed since inspection'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_sync_webhook_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_type text:=lower(coalesce(new.payload->>'event_type',''));
  v_funnel_id text:=coalesce(new.payload->>'funnel_id',new.payload->>'funnelId');
  v_product_id text:=coalesce(new.payload->>'product_id',new.payload->>'productId');
  v_conversation_id uuid;
  v_token text;
begin
  if v_event_type in ('chat_started','chat_message') then
    new.processed_at:=timezone('utc',now());
    return new;
  end if;
  if new.transaction_id is null and new.buyer_email is null then return new; end if;

  select id into v_conversation_id from public.crm_conversations
   where user_id=new.user_id
     and ((new.transaction_id is not null and transaction_id=new.transaction_id)
       or (new.buyer_email is not null and lower(buyer_email)=lower(new.buyer_email)))
   order by updated_at desc limit 1;

  if v_conversation_id is null then
    v_token:=encode(extensions.gen_random_bytes(24),'hex');
    insert into public.crm_conversations(user_id,buyer_email,buyer_name,transaction_id,funnel_id,product_id,status,metadata,public_token,last_message_at)
    values(new.user_id,new.buyer_email,new.buyer_name,new.transaction_id,v_funnel_id,v_product_id,'open',jsonb_build_object('created_from','webhook','webhook_event_id',new.id),v_token,new.received_at)
    returning id into v_conversation_id;
  else
    update public.crm_conversations set buyer_email=coalesce(new.buyer_email,buyer_email),buyer_name=coalesce(new.buyer_name,buyer_name),transaction_id=coalesce(new.transaction_id,transaction_id),funnel_id=coalesce(v_funnel_id,funnel_id),product_id=coalesce(v_product_id,product_id),updated_at=timezone('utc',now()),metadata=metadata||jsonb_build_object('last_webhook_event_id',new.id) where id=v_conversation_id;
  end if;

  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,created_at,provider)
  values(v_conversation_id,new.user_id,'inbound','internal',concat('Evento recebido: ',new.status,case when new.error_reason is not null then concat(' — ',new.error_reason) else '' end),jsonb_build_object('webhook_event_id',new.id,'transaction_id',new.transaction_id,'status',new.status,'source','crm_webhook_event'),new.received_at,'internal');

  new.processed_at:=timezone('utc',now());
  return new;
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.verify_gateway_recovery_cron_signature(bigint,text)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.verify_gateway_recovery_cron_signature(p_timestamp bigint, p_signature text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_catalog'
AS $function$
declare secret text; expected text; now_epoch bigint;
begin
  now_epoch:=extract(epoch from clock_timestamp())::bigint;
  if abs(now_epoch-p_timestamp)>300 then return false; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1;
  if secret is null or length(secret)=0 then return false; end if;
  expected:=encode(digest(secret||':'||p_timestamp::text,'sha256'),'hex');
  return lower(coalesce(p_signature,''))=lower(expected);
end;
$function$
$old$ THEN RAISE EXCEPTION 'Function changed since inspection'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.verify_gateway_recovery_cron_signature(p_timestamp bigint, p_signature text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_catalog'
AS $function$
declare secret text; expected text; now_epoch bigint;
begin
  now_epoch:=extract(epoch from clock_timestamp())::bigint;
  if abs(now_epoch-p_timestamp)>300 then return false; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='ALTHEA_INTERNAL_SECRET' limit 1;
  if secret is null or length(secret)=0 then return false; end if;
  expected:=encode(extensions.digest(secret||':'||p_timestamp::text,'sha256'),'hex');
  return lower(coalesce(p_signature,''))=lower(expected);
end;
$function$
;
