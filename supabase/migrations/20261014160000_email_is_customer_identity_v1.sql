-- Email is the customer's identity.
-- 1) resolve_customer: a phone/visitor_id match no longer absorbs a different email. Same browser
--    (visitor_id) or phone with a new email used to attach that email to the first customer, so a
--    new signup never reached Clientes/Kanban. Now a weaker match is reused only when that customer
--    has no email yet; otherwise a new customer is created (overlap goes to merge candidates).
-- 2) sync_checkout_chat_state_from_event: anonymous events (no email/phone/customer_id) created a
--    new chat conversation per event. They now only update a conversation that already exists.

CREATE OR REPLACE FUNCTION private.resolve_customer(p_organization_id uuid, p_user_id uuid, p_email text, p_phone text, p_visitor_id text DEFAULT NULL::text, p_client_id text DEFAULT NULL::text, p_profile jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_ids jsonb;
  v_client text;
  v_kind text;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'CUSTOMER_SCOPE_REQUIRED' using errcode='23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind',k,'value',v) order by k,v),'[]'::jsonb)
    into v_ids
    from (values
      ('email',private.normalize_customer_identity('email',p_email)),
      ('phone',private.normalize_customer_identity('phone',p_phone)),
      ('visitor_id',private.normalize_customer_identity('visitor_id',p_visitor_id))
    ) x(k,v)
   where v is not null;

  -- Serialize resolutions that share an identity; sorted order keeps lock acquisition deadlock-free.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_user_id::text||':'||(i->>'kind')||':'||(i->>'value'),0))
     from jsonb_array_elements(v_ids) i;

  if p_client_id is not null then
    select c.id into v_client
      from public.clients c
     where c.user_id=p_user_id and c.organization_id=p_organization_id and c.id=p_client_id;
  end if;

  if v_client is null then
    select ci.client_id, ci.kind into v_client, v_kind
      from public.customer_identities ci
      join jsonb_array_elements(v_ids) i on ci.kind=i->>'kind' and ci.value=i->>'value'
      join public.clients c on c.user_id=ci.user_id and c.id=ci.client_id
     where ci.organization_id=p_organization_id and ci.user_id=p_user_id
     -- Strongest identity wins (email > phone > visitor_id); oldest client breaks ties.
     order by case ci.kind when 'email' then 0 when 'phone' then 1 else 2 end, c.created_at asc nulls last, c.id
     limit 1;
    -- Email is the identity: a phone/visitor match with another email is a different person.
    if v_kind <> 'email' and private.normalize_customer_identity('email',p_email) is not null
       and exists (select 1 from public.customer_identities x
                    where x.organization_id=p_organization_id and x.user_id=p_user_id
                      and x.client_id=v_client and x.kind='email') then
      v_client := null;
    end if;
  end if;

  if v_client is null then
    -- An anonymous visitor_id alone only links to an existing customer; it never creates one.
    if not exists (select 1 from jsonb_array_elements(v_ids) i where i->>'kind' in ('email','phone')) then
      return null;
    end if;
    insert into public.clients(id,user_id,organization_id,data)
    values(
      gen_random_uuid()::text,p_user_id,p_organization_id,
      coalesce(p_profile,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'email',private.normalize_customer_identity('email',p_email),
        'phone',private.normalize_customer_identity('phone',p_phone)))
    )
    returning id into v_client;
  else
    -- Attach, never overwrite: existing profile keys win.
    update public.clients
       set data=coalesce(p_profile,'{}'::jsonb)
         || jsonb_strip_nulls(jsonb_build_object(
              'email',private.normalize_customer_identity('email',p_email),
              'phone',private.normalize_customer_identity('phone',p_phone)))
         || coalesce(data,'{}'::jsonb)
     where user_id=p_user_id and id=v_client;
  end if;

  insert into public.customer_identities(organization_id,user_id,client_id,kind,value)
  select p_organization_id,p_user_id,v_client,i->>'kind',i->>'value'
    from jsonb_array_elements(v_ids) i
  on conflict (organization_id,user_id,kind,value) do nothing;

  insert into public.customer_merge_candidates(organization_id,user_id,client_id,duplicate_client_id,kind,value)
  select p_organization_id,p_user_id,v_client,ci.client_id,ci.kind,ci.value
    from public.customer_identities ci
    join jsonb_array_elements(v_ids) i on ci.kind=i->>'kind' and ci.value=i->>'value'
   where ci.organization_id=p_organization_id and ci.user_id=p_user_id and ci.client_id<>v_client
  on conflict (organization_id,user_id,client_id,duplicate_client_id) do nothing;

  return v_client;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.sync_checkout_chat_state_from_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p jsonb := coalesce(new.payload,'{}'::jsonb);
  c jsonb := coalesce(p->'customer','{}'::jsonb);
  v_email text := nullif(trim(coalesce(c->>'email',p->>'email','')),'');
  v_phone text := nullif(trim(coalesce(c->>'whatsapp',c->>'phone',p->>'whatsapp',p->>'phone','')),'');
  v_customer_id text := nullif(trim(coalesce(c->>'customer_id',p->>'customer_id','')),'');
  v_conversation uuid;
  v_status public.lead_checkout_status;
  v_gateway_error text := nullif(trim(coalesce(p->>'gateway_error',p->>'error_message',p->>'decline_message','')),'');
begin
  if new.event_type not in ('page_view','quiz_started','quiz_answered','checkout_started','checkout_abandoned','payment_created','payment_failed','payment_approved','chat_started','chat_message') then
    return new;
  end if;

  v_status := case new.event_type
    when 'page_view' then 'respondendo_quiz'::public.lead_checkout_status
    when 'quiz_started' then 'respondendo_quiz'::public.lead_checkout_status
    when 'quiz_answered' then 'respondendo_quiz'::public.lead_checkout_status
    when 'checkout_started' then 'no_checkout'::public.lead_checkout_status
    when 'checkout_abandoned' then 'parado_no_caixa'::public.lead_checkout_status
    when 'payment_failed' then 'cartao_recusado'::public.lead_checkout_status
    when 'payment_approved' then 'pago'::public.lead_checkout_status
    else null
  end;

  if new.event_type in ('chat_started','chat_message') then
    select id into v_conversation
      from public.crm_conversations
     where user_id=new.user_id
       and (
         (nullif(p->>'conversation_token','') is not null and public_token=p->>'conversation_token')
         or (v_customer_id is not null and customer_id=v_customer_id and funnel_id=new.funnel_id and status <> 'closed')
         or (v_email is not null and lower(buyer_email)=lower(v_email) and funnel_id=new.funnel_id and status <> 'closed')
         or (v_phone is not null and regexp_replace(coalesce(customer_whatsapp,''),'[^0-9]+','','g')=regexp_replace(v_phone,'[^0-9]+','','g') and funnel_id=new.funnel_id and status <> 'closed')
       )
     order by updated_at desc
     limit 1;
    if v_conversation is null then
      return new;
    end if;
  else
    select id into v_conversation
      from public.crm_conversations
     where user_id=new.user_id
       and (funnel_id=new.funnel_id or (funnel_id is null and new.funnel_id is null))
       and status <> 'closed'
       and (
         (v_email is not null and lower(coalesce(buyer_email,''))=lower(v_email))
         or (v_phone is not null and regexp_replace(coalesce(customer_whatsapp,''),'[^0-9]+','','g')=regexp_replace(v_phone,'[^0-9]+','','g'))
         or (v_customer_id is not null and customer_id=v_customer_id)
       )
     order by updated_at desc
     limit 1;

    if v_conversation is null then
      -- No identity: never open a conversation per anonymous event.
      if v_email is null and v_phone is null and v_customer_id is null then
        return new;
      end if;
      insert into public.crm_conversations(
        user_id,funnel_id,transaction_id,buyer_name,buyer_email,customer_whatsapp,status,metadata,
        checkout_status,quiz_answers,gateway_error_log,last_activity_at
      ) values (
        new.user_id,new.funnel_id,nullif(p->>'transaction_id',''),
        nullif(trim(coalesce(c->>'name',p->>'name','')),''),v_email,v_phone,'open',p,
        coalesce(v_status,'respondendo_quiz'::public.lead_checkout_status),
        case when jsonb_typeof(p->'answers')='object' then p->'answers' else '{}'::jsonb end,
        v_gateway_error,coalesce(new.occurred_at,now())
      ) returning id into v_conversation;
    end if;
  end if;

  update public.crm_conversations set
    buyer_name=coalesce(nullif(trim(coalesce(c->>'name',p->>'name','')),''),buyer_name),
    buyer_email=coalesce(v_email,buyer_email),
    customer_whatsapp=coalesce(v_phone,customer_whatsapp),
    customer_id=coalesce(customer_id,v_customer_id),
    transaction_id=coalesce(nullif(p->>'transaction_id',''),transaction_id),
    metadata=case when jsonb_typeof(p)='object' then metadata || p else metadata end,
    quiz_answers=case when jsonb_typeof(p->'answers')='object' then quiz_answers || p->'answers' else quiz_answers end,
    checkout_status=coalesce(v_status,checkout_status),
    gateway_error_log=coalesce(v_gateway_error,gateway_error_log),
    last_activity_at=greatest(last_activity_at,coalesce(new.occurred_at,now())),
    updated_at=now()
  where id=v_conversation and user_id=new.user_id;

  return new;
end;
$function$

;

-- Drop the anonymous per-event conversations already created (no email, phone, customer or chat token).
delete from public.crm_conversations
 where primary_channel='funnel_chat' and public_token is null and customer_id is null
   and buyer_email is null and customer_whatsapp is null
   and not exists (select 1 from public.crm_messages m where m.conversation_id=crm_conversations.id);
