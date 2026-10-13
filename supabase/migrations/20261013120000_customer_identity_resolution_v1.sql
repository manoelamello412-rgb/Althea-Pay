-- Canonical customer identity v1.
-- public.clients stays the customer anchor (crm_conversations / crm_channel_identities already FK to it).
-- Identities (email, phone, visitor_id) now live in their own table and every writer resolves through
-- private.resolve_customer. Merge rule: attach new identities to the matched client; when identities
-- point to different clients nothing is merged automatically, a merge candidate is recorded instead.
-- ponytail: scoped by (organization_id, user_id) like every current clients lookup; widen to organization only
-- when the user_id -> organization_id migration closes (front 2 of docs/LEVANTAMENTO_2026-10-13.md).

create table if not exists public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  client_id text not null,
  kind text not null check (kind in ('email','phone','visitor_id')),
  value text not null,
  created_at timestamptz not null default now(),
  constraint customer_identities_client_fkey foreign key (user_id,client_id) references public.clients(user_id,id) on delete cascade,
  constraint customer_identities_scope_uq unique (organization_id,user_id,kind,value)
);
create index if not exists customer_identities_client_idx on public.customer_identities(user_id,client_id);

create table if not exists public.customer_merge_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  client_id text not null,
  duplicate_client_id text not null,
  kind text not null,
  value text not null,
  status text not null default 'open' check (status in ('open','merged','dismissed')),
  created_at timestamptz not null default now(),
  constraint customer_merge_candidates_client_fkey foreign key (user_id,client_id) references public.clients(user_id,id) on delete cascade,
  constraint customer_merge_candidates_duplicate_fkey foreign key (user_id,duplicate_client_id) references public.clients(user_id,id) on delete cascade,
  constraint customer_merge_candidates_distinct_ck check (client_id <> duplicate_client_id),
  constraint customer_merge_candidates_pair_uq unique (organization_id,user_id,client_id,duplicate_client_id)
);

alter table public.customer_identities enable row level security;
alter table public.customer_merge_candidates enable row level security;
drop policy if exists tenant_select on public.customer_identities;
create policy tenant_select on public.customer_identities for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists tenant_select on public.customer_merge_candidates;
create policy tenant_select on public.customer_merge_candidates for select to authenticated using (private.is_org_member(organization_id));
revoke all on public.customer_identities, public.customer_merge_candidates from public, anon, authenticated;
grant select on public.customer_identities, public.customer_merge_candidates to authenticated;
grant all on public.customer_identities, public.customer_merge_candidates to service_role;

create or replace function private.normalize_customer_identity(p_kind text, p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_kind
    when 'email' then (select v from (select lower(nullif(btrim(p_value),'')) v) x where v like '_%@_%')
    when 'phone' then (select v from (select regexp_replace(coalesce(p_value,''),'[^0-9]+','','g') v) x where length(v) between 8 and 15)
    when 'visitor_id' then nullif(btrim(p_value),'')
  end
$function$;

create or replace function private.resolve_customer(
  p_organization_id uuid,
  p_user_id uuid,
  p_email text,
  p_phone text,
  p_visitor_id text default null,
  p_client_id text default null,
  p_profile jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_ids jsonb;
  v_client text;
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
    select ci.client_id into v_client
      from public.customer_identities ci
      join jsonb_array_elements(v_ids) i on ci.kind=i->>'kind' and ci.value=i->>'value'
      join public.clients c on c.user_id=ci.user_id and c.id=ci.client_id
     where ci.organization_id=p_organization_id and ci.user_id=p_user_id
     -- Strongest identity wins (email > phone > visitor_id); oldest client breaks ties.
     order by case ci.kind when 'email' then 0 when 'phone' then 1 else 2 end, c.created_at asc nulls last, c.id
     limit 1;
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
$function$;
revoke all on function private.normalize_customer_identity(text,text) from public, anon, authenticated;
revoke all on function private.resolve_customer(uuid,uuid,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function private.resolve_customer(uuid,uuid,text,text,text,text,jsonb) to service_role;

-- Backfill: the oldest client owning an identity keeps it; every other owner becomes a merge candidate.
with raw as (
  select c.organization_id,c.user_id,c.id client_id,c.created_at,'email' kind,
         private.normalize_customer_identity('email',coalesce(c.data->>'email',c.data->>'buyer_email',c.data->>'customer_email')) value
    from public.clients c
  union all
  select c.organization_id,c.user_id,c.id,c.created_at,'phone',
         private.normalize_customer_identity('phone',coalesce(c.data->>'phone',c.data->>'whatsapp',c.data->>'customer_whatsapp',c.data->>'phone_number'))
    from public.clients c
  union all
  select c.organization_id,c.user_id,c.id,c.created_at,'email',private.normalize_customer_identity('email',i.email)
    from public.crm_channel_identities i join public.clients c on c.user_id=i.user_id and c.id=i.customer_id
  union all
  select c.organization_id,c.user_id,c.id,c.created_at,'phone',private.normalize_customer_identity('phone',i.phone_e164)
    from public.crm_channel_identities i join public.clients c on c.user_id=i.user_id and c.id=i.customer_id
)
insert into public.customer_identities(organization_id,user_id,client_id,kind,value)
select distinct on (organization_id,user_id,kind,value) organization_id,user_id,client_id,kind,value
  from raw
 where value is not null
 order by organization_id,user_id,kind,value,created_at asc nulls last,client_id
on conflict (organization_id,user_id,kind,value) do nothing;

with raw as (
  select c.organization_id,c.user_id,c.id client_id,'email' kind,
         private.normalize_customer_identity('email',coalesce(c.data->>'email',c.data->>'buyer_email',c.data->>'customer_email')) value
    from public.clients c
  union all
  select c.organization_id,c.user_id,c.id,'phone',
         private.normalize_customer_identity('phone',coalesce(c.data->>'phone',c.data->>'whatsapp',c.data->>'customer_whatsapp',c.data->>'phone_number'))
    from public.clients c
)
insert into public.customer_merge_candidates(organization_id,user_id,client_id,duplicate_client_id,kind,value)
select ci.organization_id,ci.user_id,ci.client_id,r.client_id,r.kind,r.value
  from raw r
  join public.customer_identities ci
    on ci.organization_id=r.organization_id and ci.user_id=r.user_id and ci.kind=r.kind and ci.value=r.value
 where r.value is not null and ci.client_id<>r.client_id
on conflict (organization_id,user_id,client_id,duplicate_client_id) do nothing;

-- Writers below are the latest definitions with only the customer lookup swapped for private.resolve_customer.

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
  v_client_id text;
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

  v_client_id := private.resolve_customer(
    v_tx.organization_id,v_tx.user_id,v_email,
    coalesce(v_customer->>'phone',v_customer->>'phone_number',v_customer->>'whatsapp',v_customer->>'mobile'),
    null,null,'{}'::jsonb);

  if v_client_id is null then
    return null;
  end if;

  select * into v_client
    from public.clients
   where user_id = v_tx.user_id
     and id = v_client_id
   for update;

  v_data := coalesce(v_client.data,'{}'::jsonb)
    || v_customer
    || jsonb_build_object(
      'email',coalesce(v_email,v_client.data->>'email'),
      'last_transaction_id',v_tx.id,
      'last_funnel_id',v_tx.funnel_id,
      'last_gateway_id',v_tx.gateway_id,
      'last_purchase_at',coalesce(v_tx.completed_at,now())
    );

  if v_name is not null then
    v_data := v_data || jsonb_build_object('name',v_name);
  end if;

  update public.clients
     set data=v_data
   where id=v_client.id
     and user_id=v_tx.user_id;

  update public.sales
     set data=coalesce(data,'{}'::jsonb)
       || jsonb_strip_nulls(jsonb_build_object('customer_id',v_client.id::text,'email',v_email))
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
$function$;
revoke all on function public.materialize_gateway_customer_identity(uuid) from public,anon,authenticated;
grant execute on function public.materialize_gateway_customer_identity(uuid) to service_role;

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
    if conv is null and canonical_customer_id is null and normalized_email is not null then
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
        elsif normalized_email is not null then
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
revoke all on function public.materialize_funnel_chat_event() from public,anon,authenticated;
grant execute on function public.materialize_funnel_chat_event() to service_role;

create or replace function public.crm_ingest_channel_message(
  p_user_id uuid,
  p_channel text,
  p_channel_account_id uuid,
  p_external_user_id text,
  p_body text,
  p_external_message_id text,
  p_phone_e164 text default null,
  p_email text default null,
  p_display_name text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_identity public.crm_channel_identities%rowtype;
  v_conversation public.crm_conversations%rowtype;
  v_message public.crm_messages%rowtype;
  v_channel text:=lower(trim(p_channel));
  v_provider text:=coalesce(nullif(trim(p_metadata->>'provider'),''),v_channel);
  v_email text:=lower(nullif(trim(p_email),''));
  v_customer_id text;
begin
  if p_user_id is null or nullif(v_channel,'') is null or nullif(trim(p_external_user_id),'') is null or nullif(trim(p_body),'') is null then
    raise exception 'invalid_channel_message';
  end if;

  if p_external_message_id is not null then
    select * into v_message from public.crm_messages
     where user_id=p_user_id and provider=v_provider and external_message_id=p_external_message_id
     limit 1;
    if found then
      select * into v_conversation from public.crm_conversations where id=v_message.conversation_id and user_id=p_user_id;
      return jsonb_build_object('conversation_id',v_conversation.id,'message_id',v_message.id,'identity_id',null,'deduplicated',true);
    end if;
  end if;

  v_customer_id := private.resolve_customer(
    coalesce(
      (select a.organization_id from public.crm_channel_accounts a where a.id=p_channel_account_id and a.user_id=p_user_id),
      (select pr.default_organization_id from public.profiles pr where pr.id=p_user_id)),
    p_user_id,v_email,p_phone_e164,null,null,
    jsonb_strip_nulls(jsonb_build_object('name',nullif(trim(p_display_name),''))));

  insert into public.crm_channel_identities(user_id,customer_id,channel,external_user_id,phone_e164,email,display_name,metadata,updated_at)
  values(p_user_id,v_customer_id,v_channel,trim(p_external_user_id),p_phone_e164,v_email,nullif(trim(p_display_name),''),coalesce(p_metadata,'{}'::jsonb),now())
  on conflict(user_id,channel,external_user_id) do update set
    customer_id=coalesce(crm_channel_identities.customer_id,excluded.customer_id),
    phone_e164=coalesce(excluded.phone_e164,crm_channel_identities.phone_e164),
    email=coalesce(excluded.email,crm_channel_identities.email),
    display_name=coalesce(excluded.display_name,crm_channel_identities.display_name),
    metadata=crm_channel_identities.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_identity;

  if v_identity.conversation_id is not null then
    select * into v_conversation from public.crm_conversations where id=v_identity.conversation_id and user_id=p_user_id;
  end if;

  if v_conversation.id is null and v_identity.customer_id is not null then
    select * into v_conversation from public.crm_conversations c
     where c.user_id=p_user_id and c.primary_channel=v_channel and c.channel_account_id=p_channel_account_id::text
       and c.customer_id=v_identity.customer_id and c.status in ('open','pending')
     order by c.updated_at desc limit 1;
  end if;

  if v_conversation.id is null then
    select * into v_conversation from public.crm_conversations c
     where c.user_id=p_user_id and c.primary_channel=v_channel and c.channel_account_id=p_channel_account_id::text
       and ((v_identity.email is not null and lower(c.buyer_email)=v_identity.email)
         or (v_identity.phone_e164 is not null and regexp_replace(coalesce(c.customer_whatsapp,''),'[^0-9]+','','g')=regexp_replace(v_identity.phone_e164,'[^0-9]+','','g')))
       and c.status in ('open','pending')
     order by c.updated_at desc limit 1;
  end if;

  if v_conversation.id is null then
    insert into public.crm_conversations(
      user_id,status,priority,primary_channel,channel_account_id,buyer_name,buyer_email,customer_whatsapp,customer_id,metadata
    ) values(
      p_user_id,'open','normal',v_channel,p_channel_account_id::text,v_identity.display_name,v_identity.email,v_identity.phone_e164,v_identity.customer_id,coalesce(p_metadata,'{}'::jsonb)
    ) returning * into v_conversation;
  else
    update public.crm_conversations set
      buyer_name=coalesce(buyer_name,v_identity.display_name),
      buyer_email=coalesce(buyer_email,v_identity.email),
      customer_whatsapp=coalesce(customer_whatsapp,v_identity.phone_e164),
      customer_id=coalesce(customer_id,v_identity.customer_id),
      updated_at=now()
    where id=v_conversation.id and user_id=p_user_id
    returning * into v_conversation;
  end if;

  update public.crm_channel_identities set conversation_id=v_conversation.id,customer_id=coalesce(customer_id,v_identity.customer_id),updated_at=now() where id=v_identity.id;

  insert into public.crm_messages(conversation_id,user_id,direction,channel,body,metadata,client_message_id,provider,external_message_id,channel_account_id)
  values(v_conversation.id,p_user_id,'inbound',v_channel,p_body,coalesce(p_metadata,'{}'::jsonb),p_external_message_id,v_provider,p_external_message_id,p_channel_account_id::text)
  returning * into v_message;

  return jsonb_build_object('conversation_id',v_conversation.id,'message_id',v_message.id,'identity_id',v_identity.id,'deduplicated',false);
end;
$function$;

