set local lock_timeout='3s'; set local statement_timeout='45s';
DO $guard$ BEGIN IF pg_get_functiondef('public.configure_funnel_checkout_step(uuid,uuid,jsonb)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.configure_funnel_checkout_step(p_step_id uuid, p_offer_id uuid, p_payment_methods jsonb DEFAULT '["pix", "card", "boleto"]'::jsonb)
 RETURNS funnel_steps
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_step public.funnel_steps%rowtype;
  v_offer public.funnel_offers%rowtype;
  v_funnel public.funnels%rowtype;
  v_gateway public.gateways%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_step from public.funnel_steps where id = p_step_id;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  select * into v_offer from public.funnel_offers where id = p_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;
  if v_step.funnel_id <> v_offer.funnel_id then raise exception 'FUNNEL_MISMATCH'; end if;
  if v_step.step_type not in ('checkout','payment') then raise exception 'INVALID_CHECKOUT_STEP_TYPE'; end if;

  select * into v_funnel from public.funnels where id = v_step.funnel_id and deleted_at is null;
  if not found then raise exception 'FUNNEL_NOT_FOUND'; end if;
  if v_funnel.organization_id is null then raise exception 'ORGANIZATION_REQUIRED'; end if;

  select om.role into v_role
  from public.organization_members om
  where om.organization_id = v_funnel.organization_id and om.user_id = auth.uid() and om.status = 'active'
  limit 1;
  if v_role is null or v_role not in ('owner','admin','manager','operator') then raise exception 'FORBIDDEN'; end if;

  if v_offer.organization_id <> v_funnel.organization_id then raise exception 'ORGANIZATION_MISMATCH'; end if;
  if v_offer.enabled is distinct from true then raise exception 'OFFER_NOT_ACTIVE'; end if;

  select g.* into v_gateway
  from public.funnel_gateway_bindings b
  join public.gateways g on g.id = b.gateway_id
  where b.funnel_id = v_step.funnel_id
    and b.organization_id = v_funnel.organization_id
    and b.role = 'payment'
    and b.is_primary = true
    and b.status = 'active'
    and lower(coalesce(g.status,'')) not in ('disabled','inactive','disconnected')
  order by b.priority asc
  limit 1;
  if not found then raise exception 'PRIMARY_GATEWAY_REQUIRED'; end if;

  if jsonb_typeof(p_payment_methods) <> 'array' then raise exception 'PAYMENT_METHODS_INVALID'; end if;
  if jsonb_array_length(p_payment_methods) = 0 then raise exception 'PAYMENT_METHODS_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payment_methods) method
    where method not in ('pix','card','boleto','wallet','bank_transfer','other')
  ) then raise exception 'PAYMENT_METHOD_UNSUPPORTED'; end if;

  update public.funnel_offers
  set step_id = p_step_id, updated_at = now()
  where id = p_offer_id;

  update public.funnel_steps
  set config = coalesce(config,'{}'::jsonb)
      || jsonb_build_object('checkout', jsonb_build_object(
           'offer_id', p_offer_id,
           'gateway_id', v_gateway.id,
           'payment_methods', p_payment_methods,
           'configured_at', now()
         )),
      status = case when status = 'draft' then 'active' else status end,
      updated_at = now()
  where id = p_step_id
  returning * into v_step;

  return v_step;
end;
$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: configure_funnel_checkout_step(uuid,uuid,jsonb)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.configure_funnel_checkout_step(p_step_id uuid, p_offer_id uuid, p_payment_methods jsonb DEFAULT '["pix", "card", "boleto"]'::jsonb)
 RETURNS funnel_steps
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_step public.funnel_steps%rowtype;
  v_offer public.funnel_offers%rowtype;
  v_funnel public.funnels%rowtype;
  v_gateway public.gateways%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_step from public.funnel_steps where id = p_step_id;
  if not found then raise exception 'STEP_NOT_FOUND'; end if;
  select * into v_offer from public.funnel_offers where id = p_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;
  if v_step.funnel_id is distinct from v_offer.funnel_id then raise exception 'FUNNEL_MISMATCH'; end if;
  if v_step.step_type not in ('checkout','payment') then raise exception 'INVALID_CHECKOUT_STEP_TYPE'; end if;

  select * into v_funnel from public.funnels where id = v_step.funnel_id and deleted_at is null;
  if not found then raise exception 'FUNNEL_NOT_FOUND'; end if;
  if v_funnel.organization_id is null then raise exception 'ORGANIZATION_REQUIRED'; end if;

  select om.role into v_role
  from public.organization_members om
  where om.organization_id = v_funnel.organization_id and om.user_id = auth.uid()
  limit 1;
  if v_role is null or v_role not in ('owner','admin','manager','operator') then raise exception 'FORBIDDEN'; end if;

  if v_offer.organization_id is distinct from v_funnel.organization_id or v_step.organization_id is distinct from v_funnel.organization_id then raise exception 'ORGANIZATION_MISMATCH'; end if;
  if coalesce(lower(v_offer.status),'') not in ('active','published','live') then raise exception 'OFFER_NOT_ACTIVE'; end if;

  select g.* into v_gateway
  from public.funnel_gateway_bindings b
  join public.gateways g on g.id = b.gateway_id
  where b.funnel_id = v_step.funnel_id
    and b.organization_id = v_funnel.organization_id
    and b.role = 'payment'
    and b.is_primary = true
    and b.status = 'active'
    and lower(coalesce(g.status,'')) not in ('disabled','inactive','disconnected')
  order by b.priority asc
  limit 1;
  if not found then raise exception 'PRIMARY_GATEWAY_REQUIRED'; end if;

  if jsonb_typeof(p_payment_methods) is distinct from 'array' then raise exception 'PAYMENT_METHODS_INVALID'; end if;
  if jsonb_array_length(p_payment_methods) = 0 then raise exception 'PAYMENT_METHODS_REQUIRED'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payment_methods) method
    where method is null or method not in ('pix','card','boleto','wallet','bank_transfer','other')
  ) then raise exception 'PAYMENT_METHOD_UNSUPPORTED'; end if;

  update public.funnel_offers
  set step_id = p_step_id, updated_at = now()
  where id = p_offer_id;

  update public.funnel_steps
  set config = coalesce(config,'{}'::jsonb)
      || jsonb_build_object('checkout', jsonb_build_object(
           'offer_id', p_offer_id,
           'gateway_id', v_gateway.id,
           'payment_methods', p_payment_methods,
           'configured_at', now()
         )),
      status = case when status = 'draft' then 'active' else status end,
      updated_at = now()
  where id = p_step_id
  returning * into v_step;

  return v_step;
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_mirror_client_event()'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_mirror_client_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_email text; v_funnel_id text; v_payload jsonb;
begin
  v_payload:=coalesce(new.data,'{}'::jsonb);
  v_name:=coalesce(v_payload->>'name',v_payload->>'nome',v_payload->>'full_name',v_payload->>'buyer_name',v_payload->>'customer_name');
  v_email:=coalesce(v_payload->>'email',v_payload->>'buyer_email',v_payload->>'customer_email');
  v_funnel_id:=coalesce(v_payload->>'funnel_id',v_payload->>'funnelId');
  insert into public.crm_webhook_events(user_id,idempotency_key,transaction_id,status,buyer_email,buyer_name,payload,received_at)
  values(new.user_id,'client:'||new.id||':'||coalesce(to_char(new.created_at,'YYYYMMDDHH24MISSMS'),'na'),'client.'||tg_op,v_email,v_name,v_payload||jsonb_build_object('client_id',new.id,'funnel_id',v_funnel_id),coalesce(new.created_at,timezone('utc',now())))
  on conflict (user_id,idempotency_key) where idempotency_key is not null do nothing;
  return new;
end;
$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: crm_mirror_client_event()'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_mirror_client_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text; v_email text; v_funnel_id text; v_payload jsonb;
begin
  v_payload:=coalesce(new.data,'{}'::jsonb);
  v_name:=coalesce(v_payload->>'name',v_payload->>'nome',v_payload->>'full_name',v_payload->>'buyer_name',v_payload->>'customer_name');
  v_email:=coalesce(v_payload->>'email',v_payload->>'buyer_email',v_payload->>'customer_email');
  v_funnel_id:=coalesce(v_payload->>'funnel_id',v_payload->>'funnelId');
  insert into public.crm_webhook_events(user_id,idempotency_key,transaction_id,status,buyer_email,buyer_name,payload,received_at)
  values(new.user_id,'client:'||new.id||':'||coalesce(to_char(new.created_at,'YYYYMMDDHH24MISSMS'),'na'),null,'client.'||tg_op,v_email,v_name,v_payload||jsonb_build_object('client_id',new.id,'funnel_id',v_funnel_id),coalesce(new.created_at,timezone('utc',now())))
  on conflict (user_id,idempotency_key) where idempotency_key is not null do nothing;
  return new;
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_next_best_actions(uuid)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_next_best_actions(p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(action_type text, priority integer, score numeric, rationale text, evidence jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r record;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if p_conversation_id is not null then
   select c.* into r from public.crm_conversations c where c.id=p_conversation_id and c.user_id=v_uid;
   if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
   return query
   with stats as (
     select
       r.id conversation_id,
       coalesce((select count(*) from crm_messages m where m.conversation_id=r.id and m.user_id=v_uid and m.direction='inbound'),0)::int inbound_count,
       coalesce((select count(*) from crm_messages m where m.conversation_id=r.id and m.user_id=v_uid and m.direction='outbound'),0)::int outbound_count,
       coalesce((select sum(s.amount) from sales s where s.user_id=v_uid and ((r.transaction_id is not null and s.transaction_id=r.transaction_id) or (r.buyer_email is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=lower(r.buyer_email)))),0)::numeric revenue,
       coalesce((select count(*) from crm_webhook_events e where e.user_id=v_uid and ((r.transaction_id is not null and e.transaction_id=r.transaction_id) or (r.buyer_email is not null and lower(coalesce(e.buyer_email,''))=lower(r.buyer_email)))),0)::int event_count
   )
   select 'respond'::text, 100, greatest(0,least(100,60 + case when s.inbound_count>s.outbound_count then 30 else 0 end + case when r.last_inbound_at is not null and r.first_response_at is null then 10 else 0 end))::numeric,
          case when r.first_response_at is null and r.last_inbound_at is not null then 'Cliente aguarda primeira resposta.' when s.inbound_count>s.outbound_count then 'Há mensagens recebidas sem resposta correspondente.' else 'Manter acompanhamento ativo da conversa.' end,
          jsonb_build_object('inbound_count',s.inbound_count,'outbound_count',s.outbound_count,'last_inbound_at',r.last_inbound_at,'first_response_at',r.first_response_at)
   from stats s where r.status <> 'closed'
   union all
   select 'recover'::text, 90, greatest(0,least(100,case when s.event_count>0 and s.revenue=0 then 85 else 20 end))::numeric,
          case when s.event_count>0 and s.revenue=0 then 'Existem eventos financeiros sem receita observada; avaliar recuperação.' else 'Sem sinal forte de recuperação financeira.' end,
          jsonb_build_object('event_count',s.event_count,'observed_revenue',s.revenue)
   from stats s where r.status <> 'closed' and s.event_count>0
   union all
   select 'upsell'::text, 70, 65::numeric, 'Cliente possui receita observada; avaliar oferta complementar com base no histórico real.', jsonb_build_object('observed_revenue',s.revenue)
   from stats s where r.status <> 'closed' and s.revenue>0
   order by priority desc, score desc;
 else
   return query
   select 'queue_review'::text,80,80::numeric,'Revisar fila operacional priorizando SLA e conversas não respondidas.',jsonb_build_object('open_conversations',(select count(*) from crm_conversations c where c.user_id=v_uid and c.status<>'closed'));
 end if;
end; $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: crm_next_best_actions(uuid)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_next_best_actions(p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(action_type text, priority integer, score numeric, rationale text, evidence jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r record;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if p_conversation_id is not null then
   select c.* into r from public.crm_conversations c where c.id=p_conversation_id and c.user_id=v_uid;
   if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
   return query
   with stats as (
     select
       r.id conversation_id,
       coalesce((select count(*) from crm_messages m where m.conversation_id=r.id and m.user_id=v_uid and m.direction='inbound'),0)::int inbound_count,
       coalesce((select count(*) from crm_messages m where m.conversation_id=r.id and m.user_id=v_uid and m.direction='outbound'),0)::int outbound_count,
       coalesce((select sum(s.amount) from sales s where s.user_id=v_uid and ((r.transaction_id is not null and s.transaction_id::text=r.transaction_id) or (r.buyer_email is not null and lower(coalesce(s.data->>'email',s.data->>'buyer_email',s.data->>'customer_email',''))=lower(r.buyer_email)))),0)::numeric revenue,
       coalesce((select count(*) from crm_webhook_events e where e.user_id=v_uid and ((r.transaction_id is not null and e.transaction_id=r.transaction_id) or (r.buyer_email is not null and lower(coalesce(e.buyer_email,''))=lower(r.buyer_email)))),0)::int event_count
   )
   select 'respond'::text, 100, greatest(0,least(100,60 + case when s.inbound_count>s.outbound_count then 30 else 0 end + case when r.last_inbound_at is not null and r.first_response_at is null then 10 else 0 end))::numeric,
          case when r.first_response_at is null and r.last_inbound_at is not null then 'Cliente aguarda primeira resposta.' when s.inbound_count>s.outbound_count then 'Há mensagens recebidas sem resposta correspondente.' else 'Manter acompanhamento ativo da conversa.' end,
          jsonb_build_object('inbound_count',s.inbound_count,'outbound_count',s.outbound_count,'last_inbound_at',r.last_inbound_at,'first_response_at',r.first_response_at)
   from stats s where r.status <> 'closed'
   union all
   select 'recover'::text, 90, greatest(0,least(100,case when s.event_count>0 and s.revenue=0 then 85 else 20 end))::numeric,
          case when s.event_count>0 and s.revenue=0 then 'Existem eventos financeiros sem receita observada; avaliar recuperação.' else 'Sem sinal forte de recuperação financeira.' end,
          jsonb_build_object('event_count',s.event_count,'observed_revenue',s.revenue)
   from stats s where r.status <> 'closed' and s.event_count>0
   union all
   select 'upsell'::text, 70, 65::numeric, 'Cliente possui receita observada; avaliar oferta complementar com base no histórico real.', jsonb_build_object('observed_revenue',s.revenue)
   from stats s where r.status <> 'closed' and s.revenue>0
   order by 2 desc, 3 desc;
 else
   return query
   select 'queue_review'::text,80,80::numeric,'Revisar fila operacional priorizando SLA e conversas não respondidas.',jsonb_build_object('open_conversations',(select count(*) from crm_conversations c where c.user_id=v_uid and c.status<>'closed'));
 end if;
end; $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_operator_prepare_checkout_recovery(uuid)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_operator_prepare_checkout_recovery(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.crm_conversations%rowtype;
  v_checkout public.checkout_sessions%rowtype;
  v_funnel public.funnels%rowtype;
  v_now timestamptz := now();
  v_next timestamptz;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;

  select * into v_conversation
  from public.crm_conversations
  where id = p_conversation_id and user_id = v_user_id
  for update;

  if not found then raise exception 'conversation_not_found'; end if;

  select * into v_checkout
  from public.checkout_sessions
  where user_id = v_user_id
    and (id = v_conversation.metadata->>'checkout_id' or id::text = coalesce(v_conversation.metadata->>'checkout_id',''))
  order by created_at desc
  limit 1
  for update;

  if not found and v_conversation.transaction_id is not null then
    select cs.* into v_checkout
    from public.checkout_sessions cs
    join public.gateway_transactions gt on gt.user_id = cs.user_id and gt.metadata->>'checkout_id' = cs.id::text
    where gt.user_id = v_user_id and gt.id::text = v_conversation.transaction_id
    order by cs.created_at desc
    limit 1
    for update;
  end if;

  if not found then
    select * into v_checkout
    from public.checkout_sessions
    where user_id = v_user_id
      and funnel_id = v_conversation.funnel_id
      and product_id is not distinct from v_conversation.product_id
      and status in ('started','processing','abandoned')
    order by updated_at desc
    limit 1
    for update;
  end if;

  if not found then raise exception 'checkout_session_not_found'; end if;

  if v_checkout.status in ('completed','paid') then
    raise exception 'checkout_already_completed';
  end if;

  v_next := case when v_checkout.recovery_next_at is null or v_checkout.recovery_next_at <= v_now then v_now + interval '15 minutes' else v_checkout.recovery_next_at end;

  update public.checkout_sessions
  set recovery_count = recovery_count + case when recovery_status = 'queued' and recovery_next_at > v_now then 0 else 1 end,
      recovery_status = case when recovery_status = 'queued' and recovery_next_at > v_now then 'queued' else 'queued' end,
      recovery_last_sent_at = case when recovery_status = 'queued' and recovery_next_at > v_now then recovery_last_sent_at else v_now end,
      recovery_next_at = v_next,
      updated_at = v_now
  where id = v_checkout.id and user_id = v_user_id
  returning * into v_checkout;

  if not exists (
    select 1 from public.checkout_events
    where user_id = v_user_id
      and checkout_id = v_checkout.id
      and event_type = 'recovery_queued'
      and created_at >= v_now - interval '2 seconds'
  ) then
    insert into public.checkout_events(user_id, checkout_id, event_type, payload)
    values (v_user_id, v_checkout.id, 'recovery_queued', jsonb_build_object('conversation_id', p_conversation_id, 'recovery_count', v_checkout.recovery_count, 'queued_at', v_now));
  end if;

  select * into v_funnel from public.funnels where id = v_checkout.funnel_id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'checkout_id', v_checkout.id,
    'checkout_status', v_checkout.status,
    'recovery_status', v_checkout.recovery_status,
    'recovery_count', v_checkout.recovery_count,
    'recovery_last_sent_at', v_checkout.recovery_last_sent_at,
    'recovery_next_at', v_checkout.recovery_next_at,
    'funnel_url', v_funnel.url,
    'funnel_id', v_checkout.funnel_id,
    'product_id', v_checkout.product_id,
    'amount', v_checkout.amount,
    'currency', v_checkout.currency
  );
exception
  when others then raise;
end;
$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: crm_operator_prepare_checkout_recovery(uuid)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_operator_prepare_checkout_recovery(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.crm_conversations%rowtype;
  v_checkout public.checkout_sessions%rowtype;
  v_funnel public.funnels%rowtype;
  v_now timestamptz := now();
  v_next timestamptz;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;

  select * into v_conversation
  from public.crm_conversations
  where id = p_conversation_id and user_id = v_user_id
  for update;

  if not found then raise exception 'conversation_not_found'; end if;

  select * into v_checkout
  from public.checkout_sessions
  where user_id = v_user_id
    and id::text = nullif(v_conversation.metadata->>'checkout_id','')
  order by created_at desc
  limit 1
  for update;

  if not found and v_conversation.transaction_id is not null then
    select cs.* into v_checkout
    from public.checkout_sessions cs
    join public.gateway_transactions gt on gt.user_id = cs.user_id and gt.metadata->>'checkout_id' = cs.id::text
    where gt.user_id = v_user_id and gt.id::text = v_conversation.transaction_id
    order by cs.created_at desc
    limit 1
    for update;
  end if;

  if not found then
    select * into v_checkout
    from public.checkout_sessions
    where user_id = v_user_id
      and funnel_id = v_conversation.funnel_id
      and product_id is not distinct from v_conversation.product_id
      and status in ('started','processing','abandoned')
    order by updated_at desc
    limit 1
    for update;
  end if;

  if not found then raise exception 'checkout_session_not_found'; end if;

  if v_checkout.status in ('completed','paid') then
    raise exception 'checkout_already_completed';
  end if;

  v_next := case when v_checkout.recovery_next_at is null or v_checkout.recovery_next_at <= v_now then v_now + interval '15 minutes' else v_checkout.recovery_next_at end;

  update public.checkout_sessions
  set recovery_count = recovery_count + case when recovery_status = 'queued' and recovery_next_at > v_now then 0 else 1 end,
      recovery_status = case when recovery_status = 'queued' and recovery_next_at > v_now then 'queued' else 'queued' end,
      recovery_last_sent_at = case when recovery_status = 'queued' and recovery_next_at > v_now then recovery_last_sent_at else v_now end,
      recovery_next_at = v_next,
      updated_at = v_now
  where id = v_checkout.id and user_id = v_user_id
  returning * into v_checkout;

  if not exists (
    select 1 from public.checkout_events
    where user_id = v_user_id
      and checkout_id = v_checkout.id
      and event_type = 'recovery_queued'
      and created_at >= v_now - interval '2 seconds'
  ) then
    insert into public.checkout_events(user_id, checkout_id, event_type, payload)
    values (v_user_id, v_checkout.id, 'recovery_queued', jsonb_build_object('conversation_id', p_conversation_id, 'recovery_count', v_checkout.recovery_count, 'queued_at', v_now));
  end if;

  select * into v_funnel from public.funnels where id = v_checkout.funnel_id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'checkout_id', v_checkout.id,
    'checkout_status', v_checkout.status,
    'recovery_status', v_checkout.recovery_status,
    'recovery_count', v_checkout.recovery_count,
    'recovery_last_sent_at', v_checkout.recovery_last_sent_at,
    'recovery_next_at', v_checkout.recovery_next_at,
    'funnel_url', v_funnel.url,
    'funnel_id', v_checkout.funnel_id,
    'product_id', v_checkout.product_id,
    'amount', v_checkout.amount,
    'currency', v_checkout.currency
  );
exception
  when others then raise;
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.crm_predictive_snapshot(uuid)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.crm_predictive_snapshot(p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ declare u uuid; s jsonb; id uuid; mv text; begin select user_id into u from public.crm_conversations where id=p_conversation_id and user_id=auth.uid(); if u is null then raise exception 'conversation_not_found'; end if; s:=public.crm_predictive_scores(p_conversation_id); mv:=coalesce(s->>'method','deterministic_behavioral_v1'); select e.id into id from public.crm_predictive_evaluations e where e.user_id=u and e.conversation_id=p_conversation_id and e.model_version=mv and e.created_at>=now()-interval '5 minutes' order by e.created_at desc limit 1; if id is not null then return id; end if; insert into public.crm_predictive_evaluations(user_id,conversation_id,model_version,predicted_conversion,predicted_recovery,predicted_ltv,actual_conversion,actual_recovery,actual_ltv,evaluated_at) values(u,p_conversation_id,mv,(s->>'conversion_probability')::numeric/100,(s->>'recovery_probability')::numeric/100,(s->>'ltv_propensity')::numeric/100,null,null,null,null) returning id into id; return id; end; $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: crm_predictive_snapshot(uuid)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.crm_predictive_snapshot(p_conversation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ declare u uuid; s jsonb; v_snapshot_id uuid; mv text; begin select user_id into u from public.crm_conversations where id=p_conversation_id and user_id=auth.uid(); if u is null then raise exception 'conversation_not_found'; end if; s:=public.crm_predictive_scores(p_conversation_id); mv:=coalesce(s->>'method','deterministic_behavioral_v1'); select e.id into v_snapshot_id from public.crm_predictive_evaluations e where e.user_id=u and e.conversation_id=p_conversation_id and e.model_version=mv and e.created_at>=now()-interval '5 minutes' order by e.created_at desc limit 1; if v_snapshot_id is not null then return v_snapshot_id; end if; insert into public.crm_predictive_evaluations(user_id,conversation_id,model_version,predicted_conversion,predicted_recovery,predicted_ltv,actual_conversion,actual_recovery,actual_ltv,evaluated_at) values(u,p_conversation_id,mv,(s->>'conversion_probability')::numeric/100,(s->>'recovery_probability')::numeric/100,(s->>'ltv_propensity')::numeric/100,null,null,null,null) returning crm_predictive_evaluations.id into v_snapshot_id; return v_snapshot_id; end; $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.gateway_attempt_decline_operator_event()'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.gateway_attempt_decline_operator_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_user uuid; v_tx uuid; v_gateway text; v_provider text; v_msg text; v_cat text;
begin
 if NEW.status not in ('declined','error') or (TG_OP='UPDATE' and OLD.status=NEW.status and coalesce(OLD.error_message,'')=coalesce(NEW.error_message,'') and coalesce(OLD.response_code,'')=coalesce(NEW.response_code,'')) then return NEW; end if;
 select user_id,transaction_id,gateway_id into v_user,v_tx,v_gateway from public.gateway_payment_attempts where id=NEW.id;
 select provider into v_provider from public.gateways where id=NEW.gateway_id;
 v_cat=coalesce(NEW.failure_class,'unknown');
 v_msg=coalesce(nullif(NEW.error_message,''),case when NEW.response_code is not null then 'Gateway recusou a tentativa (código '||NEW.response_code||').' else 'Gateway recusou a tentativa.' end);
 insert into public.gateway_decline_details(user_id,transaction_id,attempt_id,gateway_id,provider,provider_code,category,safe_message,raw_error,provider_request_id)
 values(v_user,v_tx,v_gateway,v_gateway,v_provider,NEW.response_code,v_cat,v_msg,jsonb_build_object('error_message',NEW.error_message,'response_code',NEW.response_code,'failure_class',NEW.failure_class),NEW.provider_request_id);
 insert into public.gateway_operator_events(user_id,transaction_id,event_type,idempotency_key,payload)
 values(v_user,v_tx,'payment.declined','attempt-decline:'||NEW.id::text,jsonb_build_object('attempt_id',NEW.id,'gateway_id',v_gateway,'provider',v_provider,'response_code',NEW.response_code,'failure_class',v_cat,'message',v_msg,'provider_request_id',NEW.provider_request_id)) on conflict do nothing;
 return NEW;
end $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: gateway_attempt_decline_operator_event()'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.gateway_attempt_decline_operator_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_user uuid; v_tx uuid; v_gateway text; v_provider text; v_msg text; v_cat text;
begin
 if NEW.status not in ('declined','error') or (TG_OP='UPDATE' and OLD.status=NEW.status and coalesce(OLD.error_message,'')=coalesce(NEW.error_message,'') and coalesce(OLD.response_code,'')=coalesce(NEW.response_code,'')) then return NEW; end if;
 select user_id,transaction_id,gateway_id into v_user,v_tx,v_gateway from public.gateway_payment_attempts where id=NEW.id;
 select provider into v_provider from public.gateways where id=NEW.gateway_id;
 v_cat=coalesce(NEW.failure_class,'unknown');
 v_msg=coalesce(nullif(NEW.error_message,''),case when NEW.response_code is not null then 'Gateway recusou a tentativa (código '||NEW.response_code||').' else 'Gateway recusou a tentativa.' end);
 insert into public.gateway_decline_details(user_id,transaction_id,attempt_id,gateway_id,provider,provider_code,category,safe_message,raw_error,provider_request_id)
 values(v_user,v_tx,NEW.id,v_gateway,v_provider,NEW.response_code,v_cat,v_msg,jsonb_build_object('error_message',NEW.error_message,'response_code',NEW.response_code,'failure_class',NEW.failure_class),NEW.provider_request_id);
 insert into public.gateway_operator_events(user_id,transaction_id,event_type,idempotency_key,payload)
 values(v_user,v_tx,'payment.declined','attempt-decline:'||NEW.id::text,jsonb_build_object('attempt_id',NEW.id,'gateway_id',v_gateway,'provider',v_provider,'response_code',NEW.response_code,'failure_class',v_cat,'message',v_msg,'provider_request_id',NEW.provider_request_id)) on conflict do nothing;
 return NEW;
end $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.gateway_routing_graph_validate_target_refs(jsonb)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.gateway_routing_graph_validate_target_refs(p_graph jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ begin return public.gateway_routing_graph_validator_v4(p_graph); exception when others then return false; end $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: gateway_routing_graph_validate_target_refs(jsonb)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.gateway_routing_graph_validate_target_refs(p_graph jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ begin return public.validate_gateway_routing_graph(p_graph); exception when others then return false; end $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.materialize_gateway_customer_identity(uuid)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.materialize_gateway_customer_identity(p_transaction_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_tx public.gateway_transactions%rowtype;
  v_checkout public.checkout_sessions%rowtype;
  v_customer jsonb := '{}'::jsonb;
  v_email text;
  v_name text;
  v_client public.clients%rowtype;
  v_data jsonb;
  v_checkout_id uuid;
begin
  select * into v_tx
    from public.gateway_transactions
   where id = p_transaction_id
   for update;

  if not found then
    return null;
  end if;

  if v_tx.status <> 'approved' then
    return null;
  end if;

  v_customer := coalesce(v_tx.customer,'{}'::jsonb);
  v_email := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
  v_name := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');

  if v_email is null then
    begin
      v_checkout_id := nullif(v_tx.metadata->>'checkout_id','')::uuid;
    exception when others then
      v_checkout_id := null;
    end;

    if v_checkout_id is not null then
      select * into v_checkout
        from public.checkout_sessions
       where id = v_checkout_id
         and user_id = v_tx.user_id;

      if found then
        v_customer := coalesce(v_checkout.customer,'{}'::jsonb) || v_customer;
        v_email := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
        v_name := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');
      end if;
    end if;
  end if;

  if v_email is null then
    return null;
  end if;

  select * into v_client
    from public.clients
   where user_id = v_tx.user_id
     and lower(coalesce(data->>'email',data->>'buyer_email',data->>'customer_email','')) = v_email
   order by created_at asc
   limit 1
   for update;

  v_data := coalesce(v_client.data,'{}'::jsonb)
    || v_customer
    || jsonb_build_object(
      'email',v_email,
      'last_transaction_id',v_tx.id,
      'last_funnel_id',v_tx.funnel_id,
      'last_gateway_id',v_tx.gateway_id,
      'last_purchase_at',coalesce(v_tx.completed_at,now())
    );

  if v_name is not null then
    v_data := v_data || jsonb_build_object('name',v_name);
  end if;

  if v_client.id is null then
    insert into public.clients(user_id,data)
    values(v_tx.user_id,v_data)
    returning * into v_client;
  else
    update public.clients
       set data=v_data
     where id=v_client.id
       and user_id=v_tx.user_id;
  end if;

  update public.sales
     set data=coalesce(data,'{}'::jsonb)
       || jsonb_build_object('customer_id',v_client.id::text,'email',v_email)
   where user_id=v_tx.user_id
     and transaction_id=v_tx.id;

  update public.crm_conversations
     set customer_id=v_client.id
   where user_id=v_tx.user_id
     and transaction_id=v_tx.id
     and customer_id is null;

  return v_client.id;
end;
$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: materialize_gateway_customer_identity(uuid)'; END IF; END $guard$;
drop function public.materialize_gateway_customer_identity(uuid);
CREATE OR REPLACE FUNCTION public.materialize_gateway_customer_identity(p_transaction_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_tx public.gateway_transactions%rowtype;
  v_checkout public.checkout_sessions%rowtype;
  v_customer jsonb := '{}'::jsonb;
  v_email text;
  v_name text;
  v_client public.clients%rowtype;
  v_data jsonb;
  v_checkout_id uuid;
begin
  select * into v_tx
    from public.gateway_transactions
   where id = p_transaction_id
   for update;

  if not found then
    return null;
  end if;

  if v_tx.status <> 'approved' then
    return null;
  end if;

  v_customer := coalesce(v_tx.customer,'{}'::jsonb);
  v_email := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
  v_name := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');

  if v_email is null then
    begin
      v_checkout_id := nullif(v_tx.metadata->>'checkout_id','')::uuid;
    exception when others then
      v_checkout_id := null;
    end;

    if v_checkout_id is not null then
      select * into v_checkout
        from public.checkout_sessions
       where id = v_checkout_id
         and user_id = v_tx.user_id
         and organization_id = v_tx.organization_id;

      if found then
        v_customer := coalesce(v_checkout.customer,'{}'::jsonb) || v_customer;
        v_email := lower(nullif(btrim(coalesce(v_customer->>'email',v_customer->>'buyer_email',v_customer->>'customer_email','')),''));
        v_name := nullif(btrim(coalesce(v_customer->>'name',v_customer->>'full_name',v_customer->>'buyer_name',v_customer->>'customer_name','')),'');
      end if;
    end if;
  end if;

  if v_email is null then
    return null;
  end if;

  select * into v_client
    from public.clients
   where user_id = v_tx.user_id
     and organization_id = v_tx.organization_id
     and lower(coalesce(data->>'email',data->>'buyer_email',data->>'customer_email','')) = v_email
   order by created_at asc
   limit 1
   for update;

  v_data := coalesce(v_client.data,'{}'::jsonb)
    || v_customer
    || jsonb_build_object(
      'email',v_email,
      'last_transaction_id',v_tx.id,
      'last_funnel_id',v_tx.funnel_id,
      'last_gateway_id',v_tx.gateway_id,
      'last_purchase_at',coalesce(v_tx.completed_at,now())
    );

  if v_name is not null then
    v_data := v_data || jsonb_build_object('name',v_name);
  end if;

  if v_client.id is null then
    insert into public.clients(id,user_id,organization_id,data)
    values(gen_random_uuid()::text,v_tx.user_id,v_tx.organization_id,v_data)
    returning * into v_client;
  else
    update public.clients
       set data=v_data
     where id=v_client.id
       and user_id=v_tx.user_id
       and organization_id=v_tx.organization_id;
  end if;

  update public.sales
     set data=coalesce(data,'{}'::jsonb)
       || jsonb_build_object('customer_id',v_client.id::text,'email',v_email)
   where user_id=v_tx.user_id
     and organization_id=v_tx.organization_id
     and transaction_id=v_tx.id;

  update public.crm_conversations
     set customer_id=v_client.id
   where user_id=v_tx.user_id
     and transaction_id=v_tx.id::text
     and customer_id is null;

  return v_client.id;
end;
$function$
;
revoke all on function public.materialize_gateway_customer_identity(uuid) from public,anon,authenticated; grant execute on function public.materialize_gateway_customer_identity(uuid) to service_role;
DO $guard$ BEGIN IF pg_get_functiondef('public.record_gateway_circuit_failure(uuid,uuid,text,text,integer)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.record_gateway_circuit_failure(p_user_id uuid, p_gateway_id uuid, p_gateway_name text, p_failure_class text, p_failure_threshold integer DEFAULT 3)
 RETURNS TABLE(circuit_state text, failure_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_key BIGINT; v_failures INTEGER; v_state TEXT;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_failure_threshold < 1 THEN RAISE EXCEPTION 'circuit_threshold_invalid'; END IF;
 IF p_failure_class NOT IN ('technical','timeout','unavailable') THEN RAISE EXCEPTION 'non_retryable_failure_cannot_open_circuit'; END IF;
 v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text,0); PERFORM pg_advisory_xact_lock(v_key);
 INSERT INTO public.gateway_circuit_states(user_id,gateway_id,gateway_name) VALUES(p_user_id,p_gateway_id,lower(trim(coalesce(p_gateway_name,p_gateway_id::text)))) ON CONFLICT (user_id,gateway_id) DO NOTHING;
 SELECT failure_count INTO v_failures FROM public.gateway_circuit_states WHERE user_id=p_user_id AND gateway_id=p_gateway_id FOR UPDATE;
 v_failures := v_failures+1; v_state := CASE WHEN v_failures>=p_failure_threshold THEN 'open' ELSE 'closed' END;
 UPDATE public.gateway_circuit_states SET gateway_name=lower(trim(coalesce(p_gateway_name,gateway_name))),failure_count=v_failures,circuit_state=v_state,opened_at=CASE WHEN v_state='open' THEN timezone('utc',now()) ELSE opened_at END,probe_until=NULL,updated_at=timezone('utc',now()),version=version+1 WHERE user_id=p_user_id AND gateway_id=p_gateway_id;
 RETURN QUERY SELECT v_state,v_failures;
END; $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: record_gateway_circuit_failure(uuid,uuid,text,text,integer)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.record_gateway_circuit_failure(p_user_id uuid, p_gateway_id uuid, p_gateway_name text, p_failure_class text, p_failure_threshold integer DEFAULT 3)
 RETURNS TABLE(circuit_state text, failure_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_key BIGINT; v_failures INTEGER; v_state TEXT;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_failure_threshold < 1 THEN RAISE EXCEPTION 'circuit_threshold_invalid'; END IF;
 IF p_failure_class NOT IN ('technical','timeout','unavailable') THEN RAISE EXCEPTION 'non_retryable_failure_cannot_open_circuit'; END IF;
 v_key := hashtextextended(p_user_id::text || ':' || p_gateway_id::text,0); PERFORM pg_advisory_xact_lock(v_key);
 INSERT INTO public.gateway_circuit_states(user_id,gateway_id,gateway_name) VALUES(p_user_id,p_gateway_id,lower(trim(coalesce(p_gateway_name,p_gateway_id::text)))) ON CONFLICT (user_id,gateway_id) DO NOTHING;
 SELECT gateway_circuit_states.failure_count INTO v_failures FROM public.gateway_circuit_states WHERE user_id=p_user_id AND gateway_id=p_gateway_id FOR UPDATE;
 v_failures := v_failures+1; v_state := CASE WHEN v_failures>=p_failure_threshold THEN 'open' ELSE 'closed' END;
 UPDATE public.gateway_circuit_states SET gateway_name=lower(trim(coalesce(p_gateway_name,gateway_name))),failure_count=v_failures,circuit_state=v_state,opened_at=CASE WHEN v_state='open' THEN timezone('utc',now()) ELSE opened_at END,probe_until=NULL,updated_at=timezone('utc',now()),version=version+1 WHERE user_id=p_user_id AND gateway_id=p_gateway_id;
 RETURN QUERY SELECT v_state,v_failures;
END; $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.register_integration_event(text,text,text,jsonb,timestamp with time zone)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.register_integration_event(p_funnel_id text, p_event_type text, p_external_id text, p_payload jsonb, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_id uuid;
  v_key text;
  v_user uuid := auth.uid();
  v_funnel_exists boolean;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select exists(
    select 1
    from public.funnels f
    where f.id = p_funnel_id
      and f.user_id = v_user
  ) into v_funnel_exists;

  if not v_funnel_exists then
    raise exception 'funnel_not_found';
  end if;

  v_key := md5(
    v_user::text || ':' ||
    coalesce(p_funnel_id,'') || ':' ||
    coalesce(p_external_id,'') || ':' ||
    coalesce(p_event_type,'') || ':' ||
    coalesce(p_occurred_at::text,'')
  );

  insert into public.integration_events(
    user_id,
    funnel_id,
    event_type,
    external_id,
    status,
    payload,
    occurred_at,
    event_key
  )
  values(
    v_user,
    p_funnel_id,
    p_event_type,
    p_external_id,
    'received',
    coalesce(p_payload,'{}'::jsonb),
    coalesce(p_occurred_at,now()),
    v_key
  )
  on conflict (event_key) do update
    set payload = excluded.payload,
        occurred_at = excluded.occurred_at
  returning id into v_id;

  update public.funnel_connections
     set last_event_at = now(),
         health_status = 'healthy',
         event_count = coalesce(event_count,0) + 1,
         last_error = null,
         connected_at = coalesce(connected_at,now()),
         updated_at = now(),
         status = 'connected'
   where user_id = v_user
     and funnel_id = p_funnel_id;

  update public.funnels
     set last_communication = now(),
         status = 'connected'
   where id = p_funnel_id
     and user_id = v_user;

  return v_id;
end;
$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: register_integration_event(text,text,text,jsonb,timestamp with time zone)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.register_integration_event(p_funnel_id text, p_event_type text, p_external_id text, p_payload jsonb, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_id uuid;
  v_key text;
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select f.organization_id into v_org from public.funnels f where f.id=p_funnel_id and f.user_id=v_user and f.deleted_at is null;

  if v_org is null then
    raise exception 'funnel_not_found';
  end if;

  v_key := md5(
    v_user::text || ':' ||
    coalesce(p_funnel_id,'') || ':' ||
    coalesce(p_external_id,'') || ':' ||
    coalesce(p_event_type,'') || ':' ||
    coalesce(p_occurred_at::text,'')
  );

  insert into public.integration_events(
    user_id,
    organization_id,
    funnel_id,
    event_type,
    external_id,
    status,
    payload,
    occurred_at,
    event_key
  )
  values(
    v_user,
    v_org,
    p_funnel_id,
    p_event_type,
    p_external_id,
    'received',
    coalesce(p_payload,'{}'::jsonb),
    coalesce(p_occurred_at,now()),
    v_key
  )
  on conflict (event_key) where event_key is not null do update
    set payload = excluded.payload,
        occurred_at = excluded.occurred_at
  returning id into v_id;

  update public.funnel_connections
     set last_event_at = now(),
         health_status = 'healthy',
         event_count = coalesce(event_count,0) + 1,
         last_error = null,
         connected_at = coalesce(connected_at,now()),
         updated_at = now(),
         status = 'connected'
   where user_id = v_user
     and funnel_id = p_funnel_id;

  update public.funnels
     set last_communication = now(),
         status = 'connected'
   where id = p_funnel_id
     and user_id = v_user;

  return v_id;
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.reserve_idempotency_key(uuid,text,text,text,interval)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.reserve_idempotency_key(p_user_id uuid, p_scope text, p_idempotency_key text, p_request_digest text, p_ttl interval DEFAULT '24:00:00'::interval)
 RETURNS TABLE(acquired boolean, id uuid, status text, response_code integer, response_payload jsonb, resource_type text, resource_id text, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$ declare v public.idempotency_keys%rowtype; v_lease uuid; begin if p_user_id is null or nullif(trim(p_scope),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception 'invalid_idempotency_arguments'; end if; if p_ttl <= interval '0 seconds' or p_ttl > interval '7 days' then raise exception 'invalid_idempotency_ttl'; end if; select * into v from public.idempotency_keys where user_id=p_user_id and scope=p_scope and idempotency_key=p_idempotency_key for update; if found then if v.expires_at <= now() then v_lease=gen_random_uuid(); update public.idempotency_keys set status='processing',request_digest=p_request_digest,response_code=null,response_payload=null,response_digest=null,resource_type=null,resource_id=null,expires_at=now()+p_ttl,updated_at=now(),lease_token=v_lease,lease_version=coalesce(lease_version,0)+1 where id=v.id; return query select true,v.id,'processing'::text,null::integer,null::jsonb,null::text,null::text,v_lease; return; end if; if v.request_digest is not null and p_request_digest is not null and v.request_digest <> p_request_digest then raise exception 'idempotency_key_reused_with_different_request'; end if; return query select false,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; return; end if; v_lease=gen_random_uuid(); begin insert into public.idempotency_keys(user_id,scope,idempotency_key,status,request_digest,expires_at,lease_token,lease_version) values(p_user_id,p_scope,p_idempotency_key,'processing',p_request_digest,now()+p_ttl,v_lease,1) returning * into v; exception when unique_violation then select * into v from public.idempotency_keys where user_id=p_user_id and scope=p_scope and idempotency_key=p_idempotency_key; if v.request_digest is not null and p_request_digest is not null and v.request_digest <> p_request_digest then raise exception 'idempotency_key_reused_with_different_request'; end if; return query select false,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; return; end; return query select true,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; end;$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: reserve_idempotency_key(uuid,text,text,text,interval)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.reserve_idempotency_key(p_user_id uuid, p_scope text, p_idempotency_key text, p_request_digest text, p_ttl interval DEFAULT '24:00:00'::interval)
 RETURNS TABLE(acquired boolean, id uuid, status text, response_code integer, response_payload jsonb, resource_type text, resource_id text, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$ declare v public.idempotency_keys%rowtype; v_lease uuid; v_org uuid; begin if p_user_id is null or nullif(trim(p_scope),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception 'invalid_idempotency_arguments'; end if; if p_ttl is null or p_ttl <= interval '0 seconds' or p_ttl > interval '7 days' then raise exception 'invalid_idempotency_ttl'; end if; select p.default_organization_id into v_org from public.profiles p join public.organization_members m on m.organization_id=p.default_organization_id and m.user_id=p.id where p.id=p_user_id; if v_org is null then raise exception 'organization_required'; end if; select * into v from public.idempotency_keys where organization_id=v_org and user_id=p_user_id and scope=p_scope and idempotency_key=p_idempotency_key for update; if found then if v.expires_at <= now() then v_lease=gen_random_uuid(); update public.idempotency_keys set status='processing',request_digest=p_request_digest,response_code=null,response_payload=null,response_digest=null,resource_type=null,resource_id=null,expires_at=now()+p_ttl,updated_at=now(),lease_token=v_lease,lease_version=coalesce(lease_version,0)+1 where idempotency_keys.id=v.id; return query select true,v.id,'processing'::text,null::integer,null::jsonb,null::text,null::text,v_lease; return; end if; if v.request_digest is not null and p_request_digest is not null and v.request_digest <> p_request_digest then raise exception 'idempotency_key_reused_with_different_request'; end if; return query select false,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; return; end if; v_lease=gen_random_uuid(); begin insert into public.idempotency_keys(organization_id,user_id,scope,idempotency_key,status,request_digest,expires_at,lease_token,lease_version) values(v_org,p_user_id,p_scope,p_idempotency_key,'processing',p_request_digest,now()+p_ttl,v_lease,1) returning * into v; exception when unique_violation then select * into v from public.idempotency_keys where organization_id=v_org and user_id=p_user_id and scope=p_scope and idempotency_key=p_idempotency_key; if v.request_digest is not null and p_request_digest is not null and v.request_digest <> p_request_digest then raise exception 'idempotency_key_reused_with_different_request'; end if; return query select false,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; return; end; return query select true,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; end;$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.settle_iara_pix(uuid,text,uuid,text,bigint,jsonb,boolean)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.settle_iara_pix(p_user_id uuid, p_event_id text, p_pix_invoice_id uuid, p_provider_payment_id text, p_paid_amount_cents bigint, p_payload jsonb, p_signature_verified boolean)
 RETURNS TABLE(settled boolean, already_settled boolean, invoice_id uuid, transaction_id uuid, journal_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ DECLARE v_invoice public.iara_pix_invoices; v_event_id UUID; v_journal_id UUID; BEGIN IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF; IF p_user_id IS NULL OR nullif(trim(p_event_id),'') IS NULL OR p_pix_invoice_id IS NULL THEN RAISE EXCEPTION 'invalid_pix_webhook_identity'; END IF; IF p_signature_verified IS NOT TRUE THEN RAISE EXCEPTION 'pix_webhook_signature_not_verified'; END IF; IF p_paid_amount_cents<=0 THEN RAISE EXCEPTION 'invalid_paid_amount'; END IF; INSERT INTO public.iara_pix_webhook_events(user_id,event_id,pix_invoice_id,provider_payment_id,payload,signature_verified) VALUES(p_user_id,trim(p_event_id),p_pix_invoice_id,nullif(trim(p_provider_payment_id),''),coalesce(p_payload,'{}'::jsonb),true) ON CONFLICT(user_id,event_id) DO NOTHING RETURNING id INTO v_event_id; SELECT * INTO v_invoice FROM public.iara_pix_invoices WHERE id=p_pix_invoice_id AND user_id=p_user_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'pix_invoice_not_found'; END IF; IF v_invoice.status='PAID' THEN IF v_event_id IS NOT NULL THEN UPDATE public.iara_pix_webhook_events SET processed_at=timezone('utc',now()) WHERE id=v_event_id; END IF; RETURN QUERY SELECT true,true,v_invoice.id,v_invoice.transaction_id::uuid,NULL::uuid,v_invoice.status; RETURN; END IF; IF p_paid_amount_cents<>v_invoice.final_amount_cents THEN RAISE EXCEPTION 'pix_paid_amount_mismatch'; END IF; IF v_invoice.status<>'PENDING' THEN RAISE EXCEPTION 'pix_invoice_not_settleable'; END IF; UPDATE public.iara_pix_invoices SET status='PAID',paid_at=timezone('utc',now()),provider_payment_id=coalesce(nullif(trim(p_provider_payment_id),''),provider_payment_id),updated_at=timezone('utc',now()) WHERE id=v_invoice.id AND user_id=p_user_id AND status='PENDING'; IF v_invoice.transaction_id IS NOT NULL AND v_invoice.gateway_id IS NOT NULL THEN PERFORM public.transition_gateway_transaction_status(v_invoice.transaction_id,p_user_id,'approved',NULL,p_provider_payment_id); SELECT public.post_gateway_financial_journal(p_user_id,v_invoice.transaction_id,v_invoice.gateway_id,'sale','pix:'||v_invoice.id::text,'BRL',jsonb_build_array(jsonb_build_object('account_code','GATEWAY_CASH','direction','debit','amount',(v_invoice.final_amount_cents::numeric/100)::text),jsonb_build_object('account_code','SALES_REVENUE','direction','credit','amount',(v_invoice.final_amount_cents::numeric/100)::text)),jsonb_build_object('payment_method','pix','provider_payment_id',p_provider_payment_id)) INTO v_journal_id; END IF; IF v_event_id IS NOT NULL THEN UPDATE public.iara_pix_webhook_events SET processed_at=timezone('utc',now()) WHERE id=v_event_id; END IF; RETURN QUERY SELECT true,false,v_invoice.id,v_invoice.transaction_id,v_journal_id,'PAID'::text; END; $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: settle_iara_pix(uuid,text,uuid,text,bigint,jsonb,boolean)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.settle_iara_pix(p_user_id uuid, p_event_id text, p_pix_invoice_id uuid, p_provider_payment_id text, p_paid_amount_cents bigint, p_payload jsonb, p_signature_verified boolean)
 RETURNS TABLE(settled boolean, already_settled boolean, invoice_id uuid, transaction_id uuid, journal_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ DECLARE v_invoice public.iara_pix_invoices; v_event_id UUID; v_journal_id UUID; v_transaction public.gateway_transactions; v_sale_source text; BEGIN IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF; IF p_user_id IS NULL OR nullif(trim(p_event_id),'') IS NULL OR p_pix_invoice_id IS NULL THEN RAISE EXCEPTION 'invalid_pix_webhook_identity'; END IF; IF p_signature_verified IS NOT TRUE THEN RAISE EXCEPTION 'pix_webhook_signature_not_verified'; END IF; IF p_paid_amount_cents<=0 THEN RAISE EXCEPTION 'invalid_paid_amount'; END IF; INSERT INTO public.iara_pix_webhook_events(user_id,event_id,pix_invoice_id,provider_payment_id,payload,signature_verified) VALUES(p_user_id,trim(p_event_id),p_pix_invoice_id,nullif(trim(p_provider_payment_id),''),coalesce(p_payload,'{}'::jsonb),true) ON CONFLICT(user_id,event_id) DO NOTHING RETURNING id INTO v_event_id; SELECT * INTO v_invoice FROM public.iara_pix_invoices WHERE id=p_pix_invoice_id AND user_id=p_user_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'pix_invoice_not_found'; END IF; IF v_invoice.status='PAID' THEN IF v_event_id IS NOT NULL THEN UPDATE public.iara_pix_webhook_events SET processed_at=timezone('utc',now()) WHERE id=v_event_id; END IF; RETURN QUERY SELECT true,true,v_invoice.id,v_invoice.transaction_id::uuid,NULL::uuid,v_invoice.status; RETURN; END IF; IF p_paid_amount_cents<>v_invoice.final_amount_cents THEN RAISE EXCEPTION 'pix_paid_amount_mismatch'; END IF; IF v_invoice.status<>'PENDING' THEN RAISE EXCEPTION 'pix_invoice_not_settleable'; END IF; UPDATE public.iara_pix_invoices SET status='PAID',paid_at=timezone('utc',now()),provider_payment_id=coalesce(nullif(trim(p_provider_payment_id),''),provider_payment_id),updated_at=timezone('utc',now()) WHERE id=v_invoice.id AND user_id=p_user_id AND iara_pix_invoices.status='PENDING'; IF v_invoice.transaction_id IS NOT NULL AND v_invoice.gateway_id IS NOT NULL THEN SELECT * INTO v_transaction FROM public.gateway_transactions gt WHERE gt.id=v_invoice.transaction_id AND gt.user_id=p_user_id FOR UPDATE;
IF NOT FOUND OR v_transaction.gateway_id IS DISTINCT FROM v_invoice.gateway_id OR v_transaction.currency<>'BRL' OR v_transaction.amount*100<>v_invoice.final_amount_cents THEN RAISE EXCEPTION 'pix_transaction_mismatch'; END IF;
IF v_transaction.status<>'approved' THEN
 SELECT * INTO v_transaction FROM public.transition_gateway_transaction_status(v_invoice.transaction_id,p_user_id,'approved',NULL,p_provider_payment_id,v_transaction.version);
END IF;
SELECT source_event_key INTO v_sale_source FROM public.gateway_financial_journals fj WHERE fj.user_id=p_user_id AND fj.transaction_id=v_invoice.transaction_id AND fj.journal_type='sale' AND fj.status='posted' AND source_event_key LIKE 'gateway_transaction:'||v_invoice.transaction_id::text||':approved:%' ORDER BY posted_at LIMIT 1;
v_sale_source:=coalesce(v_sale_source,'gateway_transaction:'||v_invoice.transaction_id::text||':approved:'||v_transaction.version::text); SELECT public.post_gateway_financial_journal(p_user_id,v_invoice.transaction_id,v_invoice.gateway_id,'sale',v_sale_source,'BRL',jsonb_build_array(jsonb_build_object('account_code','gateway_receivable','direction','debit','amount',(v_invoice.final_amount_cents::numeric/100)::text),jsonb_build_object('account_code','merchant_sales','direction','credit','amount',(v_invoice.final_amount_cents::numeric/100)::text)),jsonb_build_object('payment_method','pix','provider_payment_id',p_provider_payment_id)) INTO v_journal_id; END IF; IF v_event_id IS NOT NULL THEN UPDATE public.iara_pix_webhook_events SET processed_at=timezone('utc',now()) WHERE id=v_event_id; END IF; RETURN QUERY SELECT true,false,v_invoice.id,v_invoice.transaction_id,v_journal_id,'PAID'::text; END; $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.transition_gateway_recovery_state(uuid,bigint,recovery_state,text,timestamp with time zone)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.transition_gateway_recovery_state(p_job_id uuid, p_expected_version bigint, p_next_state recovery_state, p_note text DEFAULT NULL::text, p_next_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(updated boolean, state_version bigint, current_state recovery_state)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_version bigint; v_current public.recovery_state;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF p_next_state IS NULL THEN RAISE EXCEPTION 'recovery_state_required'; END IF;
 UPDATE public.gateway_recovery_queue
 SET recovery_state=p_next_state,state_version=state_version+1,
     status=CASE p_next_state
       WHEN 'APPROVED' THEN 'resolved'
       WHEN 'DECLINED' THEN 'not_found'
       WHEN 'DEAD_LETTER' THEN 'dead_letter'
       WHEN 'STATUS_CHECK' THEN 'processing'
       WHEN 'RECOVERY' THEN 'queued'
       WHEN 'UNKNOWN' THEN 'queued'
       WHEN 'PENDING' THEN 'queued'
       ELSE status END,
     next_retry_at=CASE WHEN p_next_state IN ('RECOVERY','UNKNOWN','PENDING') THEN coalesce(p_next_retry_at,now()) ELSE p_next_retry_at END,
     execution_logs=execution_logs||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'from_state',recovery_state::text,'from_version',state_version,'to',p_next_state::text,'note',p_note)),
     updated_at=clock_timestamp()
 WHERE id=p_job_id AND state_version=p_expected_version
 RETURNING gateway_recovery_queue.state_version,gateway_recovery_queue.recovery_state INTO v_version,v_current;
 IF NOT FOUND THEN RETURN QUERY SELECT false,NULL::bigint,NULL::public.recovery_state; ELSE RETURN QUERY SELECT true,v_version,v_current; END IF;
END;$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: transition_gateway_recovery_state(uuid,bigint,recovery_state,text,timestamp with time zone)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.transition_gateway_recovery_state(p_job_id uuid, p_expected_version bigint, p_next_state recovery_state, p_note text DEFAULT NULL::text, p_next_retry_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(updated boolean, state_version bigint, current_state recovery_state)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_version bigint; v_current public.recovery_state;
BEGIN
 IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF p_next_state IS NULL THEN RAISE EXCEPTION 'recovery_state_required'; END IF;
 UPDATE public.gateway_recovery_queue
 SET recovery_state=p_next_state,state_version=gateway_recovery_queue.state_version+1,
     status=CASE p_next_state
       WHEN 'APPROVED' THEN 'resolved'
       WHEN 'DECLINED' THEN 'not_found'
       WHEN 'DEAD_LETTER' THEN 'dead_letter'
       WHEN 'STATUS_CHECK' THEN 'processing'
       WHEN 'RECOVERY' THEN 'queued'
       WHEN 'UNKNOWN' THEN 'queued'
       WHEN 'PENDING' THEN 'queued'
       ELSE status END,
     next_retry_at=CASE WHEN p_next_state IN ('RECOVERY','UNKNOWN','PENDING') THEN coalesce(p_next_retry_at,now()) ELSE coalesce(p_next_retry_at,gateway_recovery_queue.next_retry_at,now()) END,
     execution_logs=execution_logs||jsonb_build_array(jsonb_build_object('at',clock_timestamp(),'from_state',recovery_state::text,'from_version',gateway_recovery_queue.state_version,'to',p_next_state::text,'note',p_note)),
     updated_at=clock_timestamp()
 WHERE id=p_job_id AND gateway_recovery_queue.state_version=p_expected_version
 RETURNING gateway_recovery_queue.state_version,gateway_recovery_queue.recovery_state INTO v_version,v_current;
 IF NOT FOUND THEN RETURN QUERY SELECT false,NULL::bigint,NULL::public.recovery_state; ELSE RETURN QUERY SELECT true,v_version,v_current; END IF;
END;$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.validate_gateway_credential_schema(jsonb,jsonb)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.validate_gateway_credential_schema(p_schema jsonb, p_credentials jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  f jsonb;
  name text;
  typ text;
  required boolean;
  value jsonb;
begin
  if jsonb_typeof(p_schema) <> 'object' or jsonb_typeof(p_credentials) <> 'object' then return false; end if;
  if jsonb_typeof(coalesce(p_schema->'fields','[]'::jsonb)) <> 'array' then return false; end if;
  for f in select value from jsonb_array_elements(p_schema->'fields') loop
    name := nullif(trim(f->>'name'),''); typ := lower(coalesce(f->>'type','text')); required := coalesce((f->>'required')::boolean,false);
    if name is null or typ not in ('text','password') then return false; end if;
    value := p_credentials->name;
    if required and (value is null or jsonb_typeof(value) <> 'string' or length(trim(value #>> '{}')) = 0) then return false; end if;
    if value is not null and jsonb_typeof(value) <> 'string' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: validate_gateway_credential_schema(jsonb,jsonb)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.validate_gateway_credential_schema(p_schema jsonb, p_credentials jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  f jsonb;
  name text;
  typ text;
  required boolean;
  value jsonb;
begin
  if jsonb_typeof(p_schema) is distinct from 'object' or jsonb_typeof(p_credentials) is distinct from 'object' then return false; end if;
  if jsonb_typeof(coalesce(p_schema->'fields','[]'::jsonb)) <> 'array' then return false; end if;
  for f in select field_item.value from jsonb_array_elements(p_schema->'fields') as field_item(value) loop
    name := nullif(trim(f->>'name'),''); typ := lower(coalesce(f->>'type','text')); required := coalesce((f->>'required')::boolean,false);
    if name is null or typ not in ('text','password') then return false; end if;
    value := p_credentials->name;
    if required and (value is null or jsonb_typeof(value) <> 'string' or length(trim(value #>> '{}')) = 0) then return false; end if;
    if value is not null and jsonb_typeof(value) <> 'string' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.project_funnel_event(uuid)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.project_funnel_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  e public.integration_events%rowtype;
  p jsonb;
  v_session text;
  v_checkout uuid;
  v_tx uuid;
  v_sale text;
  v_transitioned public.gateway_transactions;
begin
  select * into e from public.integration_events where id=p_event_id for update;
  if not found then return jsonb_build_object('ok',false,'error','event_not_found'); end if;
  p=coalesce(e.payload,'{}'::jsonb);

  if e.event_type='page_view' then
    v_session=coalesce(nullif(p->>'session_key',''),nullif(p->>'session_id',''));
    if v_session is not null then
      insert into public.attribution_sessions(user_id,funnel_id,session_key,source,medium,campaign,content,term,click_id,landing_url,first_seen_at,last_seen_at,metadata)
      values(e.user_id,e.funnel_id,v_session,p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',p->>'landing_url',coalesce(e.occurred_at,now()),coalesce(e.occurred_at,now()),coalesce(p->'metadata','{}'::jsonb))
      on conflict do nothing;
    end if;
  elsif e.event_type in ('checkout_started','checkout_abandoned') then
    if nullif(p->>'checkout_id','') is not null then
      v_checkout=(p->>'checkout_id')::uuid;
      update public.checkout_sessions
      set status=case when e.event_type='checkout_abandoned' then 'abandoned' else 'pending' end,
          abandoned_at=case when e.event_type='checkout_abandoned' then coalesce(abandoned_at,e.occurred_at,now()) else abandoned_at end,
          updated_at=now()
      where id=v_checkout and user_id=e.user_id;
    end if;
  elsif e.event_type in ('purchase','upsell') then
    if nullif(p->>'transaction_id','') is not null then
      v_tx=(p->>'transaction_id')::uuid;
      select * into v_transitioned
      from public.transition_gateway_transaction_status(
        v_tx,e.user_id,'approved',nullif(p->>'failure_code',''),nullif(p->>'external_id','')
      );
    end if;

    v_sale=coalesce(nullif(p->>'sale_id',''),nullif(p->>'external_id',''),e.external_id,'sale_'||e.id::text);
    if v_tx is not null then
      insert into public.sales(id,user_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
      values(v_sale,e.user_id,e.funnel_id,nullif(p->>'product_id',''),v_checkout,v_tx,coalesce((p->>'amount')::numeric,0),coalesce(nullif(p->>'currency',''),'BRL'),'approved',coalesce(p->'attribution','{}'::jsonb),p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',e.external_id,p->>'gateway_id',coalesce(e.occurred_at,now()),p)
      on conflict (user_id, transaction_id) where transaction_id is not null do update
      set status='approved',amount=excluded.amount,checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),occurred_at=excluded.occurred_at,data=excluded.data,external_id=coalesce(excluded.external_id,public.sales.external_id),gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id);
    else
      insert into public.sales(id,user_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
      values(v_sale,e.user_id,e.funnel_id,nullif(p->>'product_id',''),v_checkout,null,coalesce((p->>'amount')::numeric,0),coalesce(nullif(p->>'currency',''),'BRL'),'approved',coalesce(p->'attribution','{}'::jsonb),p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',e.external_id,p->>'gateway_id',coalesce(e.occurred_at,now()),p)
      on conflict (id) do update set status='approved',amount=excluded.amount,occurred_at=excluded.occurred_at,data=excluded.data;
    end if;
  elsif e.event_type in ('refund','chargeback') then
    if nullif(p->>'transaction_id','') is not null then
      v_tx=(p->>'transaction_id')::uuid;
      select * into v_transitioned
      from public.transition_gateway_transaction_status(
        v_tx,e.user_id,case when e.event_type='chargeback' then 'chargeback' else 'refunded' end,null,nullif(p->>'external_id','')
      );
      update public.sales set status=case when e.event_type='chargeback' then 'chargeback' else 'refunded' end where transaction_id=v_tx and user_id=e.user_id;
    elsif e.external_id is not null then
      update public.sales set status=case when e.event_type='chargeback' then 'chargeback' else 'refunded' end where external_id=e.external_id and user_id=e.user_id;
    end if;
  end if;
  return jsonb_build_object('ok',true,'event_id',e.id,'event_type',e.event_type);
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: project_funnel_event(uuid)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.project_funnel_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  e public.integration_events%rowtype;
  p jsonb;
  v_session text;
  v_checkout uuid;
  v_tx uuid;
  v_sale text;
  v_transitioned public.gateway_transactions;
begin
  select * into e from public.integration_events where id=p_event_id for update;
  if not found then return jsonb_build_object('ok',false,'error','event_not_found'); end if;
  p=coalesce(e.payload,'{}'::jsonb);

  if e.event_type='page_view' then
    v_session=coalesce(nullif(p->>'session_key',''),nullif(p->>'session_id',''));
    if v_session is not null then
      insert into public.attribution_sessions(user_id,organization_id,funnel_id,session_key,source,medium,campaign,content,term,click_id,landing_url,first_seen_at,last_seen_at,metadata)
      values(e.user_id,e.organization_id,e.funnel_id,v_session,p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',p->>'landing_url',coalesce(e.occurred_at,now()),coalesce(e.occurred_at,now()),coalesce(p->'metadata','{}'::jsonb))
      on conflict do nothing;
    end if;
  elsif e.event_type in ('checkout_started','checkout_abandoned') then
    if nullif(p->>'checkout_id','') is not null then
      v_checkout=(p->>'checkout_id')::uuid;
      update public.checkout_sessions
      set status=case when e.event_type='checkout_abandoned' then 'abandoned' else 'pending' end,
          abandoned_at=case when e.event_type='checkout_abandoned' then coalesce(abandoned_at,e.occurred_at,now()) else abandoned_at end,
          updated_at=now()
      where id=v_checkout and user_id=e.user_id;
    end if;
  elsif e.event_type in ('purchase','upsell') then
    if nullif(p->>'transaction_id','') is not null then
      v_tx=(p->>'transaction_id')::uuid;
      select * into v_transitioned
      from public.transition_gateway_transaction_status(
        v_tx,e.user_id,'approved',nullif(p->>'failure_code',''),nullif(p->>'external_id',''),(select gt.version from public.gateway_transactions gt where gt.id=v_tx and gt.user_id=e.user_id for update)
      );
    end if;

    v_sale=coalesce(nullif(p->>'sale_id',''),nullif(p->>'external_id',''),e.external_id,'sale_'||e.id::text);
    if v_tx is not null then
      insert into public.sales(id,user_id,organization_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
      values(v_sale,e.user_id,e.organization_id,e.funnel_id,nullif(p->>'product_id',''),v_checkout,v_tx,coalesce((p->>'amount')::numeric,0),coalesce(nullif(p->>'currency',''),'BRL'),'approved',coalesce(p->'attribution','{}'::jsonb),p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',e.external_id,p->>'gateway_id',coalesce(e.occurred_at,now()),p)
      on conflict (user_id, transaction_id) where transaction_id is not null do update
      set status='approved',amount=excluded.amount,checkout_id=coalesce(excluded.checkout_id,public.sales.checkout_id),occurred_at=excluded.occurred_at,data=excluded.data,external_id=coalesce(excluded.external_id,public.sales.external_id),gateway_id=coalesce(excluded.gateway_id,public.sales.gateway_id);
    else
      insert into public.sales(id,user_id,organization_id,funnel_id,product_id,checkout_id,transaction_id,amount,currency,status,attribution,source,medium,campaign,content,term,click_id,external_id,gateway_id,occurred_at,data)
      values(v_sale,e.user_id,e.organization_id,e.funnel_id,nullif(p->>'product_id',''),v_checkout,null,coalesce((p->>'amount')::numeric,0),coalesce(nullif(p->>'currency',''),'BRL'),'approved',coalesce(p->'attribution','{}'::jsonb),p->>'source',p->>'medium',p->>'campaign',p->>'content',p->>'term',p->>'click_id',e.external_id,p->>'gateway_id',coalesce(e.occurred_at,now()),p)
      on conflict (id) do update set status='approved',amount=excluded.amount,occurred_at=excluded.occurred_at,data=excluded.data;
    end if;
  elsif e.event_type in ('refund','chargeback') then
    if nullif(p->>'transaction_id','') is not null then
      v_tx=(p->>'transaction_id')::uuid;
      select * into v_transitioned
      from public.transition_gateway_transaction_status(
        v_tx,e.user_id,case when e.event_type='chargeback' then 'chargeback' else 'refunded' end,null,nullif(p->>'external_id',''),(select gt.version from public.gateway_transactions gt where gt.id=v_tx and gt.user_id=e.user_id for update)
      );
      update public.sales set status=case when e.event_type='chargeback' then 'chargeback' else 'refunded' end where transaction_id=v_tx and user_id=e.user_id;
    elsif e.external_id is not null then
      update public.sales set status=case when e.event_type='chargeback' then 'chargeback' else 'refunded' end where external_id=e.external_id and user_id=e.user_id;
    end if;
  end if;
  return jsonb_build_object('ok',true,'event_id',e.id,'event_type',e.event_type);
exception when others then
  return jsonb_build_object('ok',false,'error',sqlerrm);
end;
$function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.prevent_gateway_financial_mutation()'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.prevent_gateway_financial_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin raise exception 'gateway financial ledger is immutable'; end $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: prevent_gateway_financial_mutation()'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.prevent_gateway_financial_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin
 if TG_TABLE_NAME='gateway_financial_journals' and TG_OP='UPDATE' then
   if to_jsonb(OLD)->>'status'='draft' and to_jsonb(NEW)->>'status'='posted'
      and (to_jsonb(NEW)-'status'-'posted_at')=(to_jsonb(OLD)-'status'-'posted_at') then return NEW; end if;
 end if;
 raise exception 'gateway financial ledger is immutable'; end $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.enforce_gateway_financial_journal_balance()'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.enforce_gateway_financial_journal_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare debit_total numeric; credit_total numeric; entry_count integer; j_status text;
begin
  if new.status='posted' then
    select count(*),coalesce(sum(amount) filter(where direction='debit'),0),coalesce(sum(amount) filter(where direction='credit'),0)
      into entry_count,debit_total,credit_total
      from public.gateway_financial_entries where journal_id=new.id;
    if entry_count<2 or debit_total<>credit_total then raise exception 'posted journal must have at least two balanced entries'; end if;
  end if;
  return new;
end $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: enforce_gateway_financial_journal_balance()'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.enforce_gateway_financial_journal_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare debit_total numeric; credit_total numeric; entry_count integer; j_status text;
begin
  select status into j_status from public.gateway_financial_journals where id=new.id;
  if j_status='draft' then raise exception 'financial journal must be finalized before commit'; end if;
  if j_status='posted' then
    select count(*),coalesce(sum(amount) filter(where direction='debit'),0),coalesce(sum(amount) filter(where direction='credit'),0)
      into entry_count,debit_total,credit_total
      from public.gateway_financial_entries where journal_id=new.id;
    if entry_count<2 or debit_total<>credit_total then raise exception 'posted journal must have at least two balanced entries'; end if;
  end if;
  return new;
end $function$
;
DO $guard$ BEGIN IF pg_get_functiondef('public.post_gateway_financial_journal(uuid,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM $old$CREATE OR REPLACE FUNCTION public.post_gateway_financial_journal(p_user_id uuid, p_transaction_id uuid, p_gateway_id text, p_journal_type text, p_source_event_key text, p_currency text, p_lines jsonb, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_journal uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_line jsonb;
  v_amount numeric;
  v_direction text;
  v_account text;
  v_tx_user uuid;
  v_gateway_user uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_source_event_key is null or length(trim(p_source_event_key)) < 1 then raise exception 'invalid_journal_identity'; end if;
  if lower(trim(p_journal_type)) not in ('sale','refund','chargeback','fee','adjustment') then raise exception 'invalid_journal_type'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'journal_lines_required'; end if;
  select user_id into v_tx_user from public.gateway_transactions where id=p_transaction_id;
  if p_transaction_id is not null and (v_tx_user is null or v_tx_user <> p_user_id) then raise exception 'transaction_tenant_mismatch'; end if;
  select user_id into v_gateway_user from public.gateways where id=p_gateway_id;
  if p_gateway_id is not null and (v_gateway_user is null or v_gateway_user <> p_user_id) then raise exception 'gateway_tenant_mismatch'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_direction := lower(trim(coalesce(v_line->>'direction','')));
    v_account := trim(coalesce(v_line->>'account_code',''));
    begin v_amount := nullif(v_line->>'amount','')::numeric; exception when others then raise exception 'invalid_journal_line'; end;
    if v_direction not in ('debit','credit') or v_account='' or v_amount is null or v_amount <= 0 then raise exception 'invalid_journal_line'; end if;
    if v_direction='debit' then v_debit := v_debit + v_amount; else v_credit := v_credit + v_amount; end if;
  end loop;
  if round(v_debit,4) <> round(v_credit,4) then raise exception 'unbalanced_journal'; end if;
  insert into public.gateway_financial_journals(user_id,transaction_id,gateway_id,journal_type,source_event_key,currency,metadata)
  values(p_user_id,p_transaction_id,p_gateway_id,lower(trim(p_journal_type)),trim(p_source_event_key),p_currency,coalesce(p_metadata,'{}'::jsonb))
  on conflict (user_id,source_event_key) do update set source_event_key=excluded.source_event_key
  returning id into v_journal;
  if not exists (select 1 from public.gateway_financial_entries where journal_id=v_journal) then
    for v_line in select value from jsonb_array_elements(p_lines) loop
      insert into public.gateway_financial_entries(journal_id,user_id,account_code,direction,amount,currency)
      values(v_journal,p_user_id,trim(v_line->>'account_code'),lower(trim(v_line->>'direction')),(v_line->>'amount')::numeric,p_currency);
    end loop;
  end if;
  return v_journal;
end; $function$
$old$ THEN RAISE EXCEPTION 'Concurrent function change: post_gateway_financial_journal(uuid,uuid,text,text,text,text,jsonb,jsonb)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.post_gateway_financial_journal(p_user_id uuid, p_transaction_id uuid, p_gateway_id text, p_journal_type text, p_source_event_key text, p_currency text, p_lines jsonb, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_journal uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_line jsonb;
  v_amount numeric;
  v_direction text;
  v_account text;
  v_tx_user uuid;
  v_gateway_user uuid;
  v_existing public.gateway_financial_journals%rowtype;
  v_existing_lines jsonb;
  v_requested_lines jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  if p_user_id is null or p_source_event_key is null or length(trim(p_source_event_key)) < 1 then raise exception 'invalid_journal_identity'; end if;
  if lower(trim(p_journal_type)) not in ('sale','refund','chargeback','fee','adjustment') then raise exception 'invalid_journal_type'; end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'journal_lines_required'; end if;
  select user_id into v_tx_user from public.gateway_transactions where id=p_transaction_id;
  if p_transaction_id is not null and (v_tx_user is null or v_tx_user <> p_user_id) then raise exception 'transaction_tenant_mismatch'; end if;
  select user_id into v_gateway_user from public.gateways where id=p_gateway_id;
  if p_gateway_id is not null and (v_gateway_user is null or v_gateway_user <> p_user_id) then raise exception 'gateway_tenant_mismatch'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_direction := lower(trim(coalesce(v_line->>'direction','')));
    v_account := trim(coalesce(v_line->>'account_code',''));
    begin v_amount := nullif(v_line->>'amount','')::numeric; exception when others then raise exception 'invalid_journal_line'; end;
    if v_direction not in ('debit','credit') or v_account='' or v_amount is null or v_amount <= 0 then raise exception 'invalid_journal_line'; end if;
    if v_direction='debit' then v_debit := v_debit + v_amount; else v_credit := v_credit + v_amount; end if;
  end loop;
  if v_debit <> v_credit then raise exception 'unbalanced_journal'; end if;
  insert into public.gateway_financial_journals(user_id,transaction_id,gateway_id,journal_type,source_event_key,currency,metadata,status)
  values(p_user_id,p_transaction_id,p_gateway_id,lower(trim(p_journal_type)),trim(p_source_event_key),p_currency,coalesce(p_metadata,'{}'::jsonb),'draft')
  on conflict (user_id,source_event_key) do nothing
  returning id into v_journal;
  if v_journal is null then
    select * into v_existing from public.gateway_financial_journals
    where user_id=p_user_id and source_event_key=trim(p_source_event_key) for update;
    if v_existing.status is distinct from 'posted'
       or v_existing.transaction_id is distinct from p_transaction_id
       or v_existing.gateway_id is distinct from p_gateway_id
       or v_existing.journal_type is distinct from lower(trim(p_journal_type))
       or v_existing.currency is distinct from p_currency then raise exception 'journal_idempotency_conflict'; end if;
    select jsonb_agg(jsonb_build_array(account_code,direction,amount) order by account_code,direction,amount)
      into v_existing_lines from public.gateway_financial_entries where journal_id=v_existing.id;
    select jsonb_agg(jsonb_build_array(trim(x->>'account_code'),lower(trim(x->>'direction')),(x->>'amount')::numeric)
      order by trim(x->>'account_code'),lower(trim(x->>'direction')),(x->>'amount')::numeric)
      into v_requested_lines from jsonb_array_elements(p_lines) x;
    if v_existing_lines is distinct from v_requested_lines then raise exception 'journal_idempotency_conflict'; end if;
    return v_existing.id;
  end if;
  if not exists (select 1 from public.gateway_financial_entries where journal_id=v_journal) then
    for v_line in select value from jsonb_array_elements(p_lines) loop
      insert into public.gateway_financial_entries(journal_id,user_id,account_code,direction,amount,currency)
      values(v_journal,p_user_id,trim(v_line->>'account_code'),lower(trim(v_line->>'direction')),(v_line->>'amount')::numeric,p_currency);
    end loop;
  end if;
  update public.gateway_financial_journals set status='posted',posted_at=clock_timestamp() where id=v_journal;
  return v_journal;
end; $function$
;
grant execute on function public.validate_gateway_routing_graph(jsonb), public.gateway_routing_graph_walk(jsonb,integer,text[]), public.gateway_routing_graph_condition_valid(jsonb) to service_role;

ALTER TABLE public.gateway_financial_journals DROP CONSTRAINT gateway_financial_journals_status_ck;
ALTER TABLE public.gateway_financial_journals ADD CONSTRAINT gateway_financial_journals_status_ck CHECK (status in ('draft','posted','voided'));
