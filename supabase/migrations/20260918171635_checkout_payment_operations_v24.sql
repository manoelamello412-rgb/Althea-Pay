
alter table public.gateway_webhook_events
  add column if not exists user_id uuid,
  add column if not exists organization_id uuid,
  add column if not exists transaction_id uuid;

create or replace function public.link_gateway_webhook_event_context()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_external text;
begin
  if new.gateway_id is not null then
    select g.user_id,g.organization_id
      into new.user_id,new.organization_id
    from public.gateways g
    where g.id=new.gateway_id
    limit 1;
  end if;

  if new.transaction_id is null and new.gateway_id is not null then
    v_external:=nullif(trim(coalesce(
      new.payload->>'external_transaction_id',
      new.payload->>'external_id',
      new.payload->>'transaction_id',
      new.payload->>'transactionId',
      new.payload->>'payment_id',
      new.payload->>'paymentId',
      new.payload#>>'{data,external_transaction_id}',
      new.payload#>>'{data,external_id}',
      new.payload#>>'{data,transaction_id}',
      new.payload#>>'{data,transactionId}',
      new.payload#>>'{data,payment_id}',
      new.payload#>>'{data,paymentId}',
      ''
    )),'');

    if v_external is not null then
      select t.id
        into new.transaction_id
      from public.gateway_transactions t
      where t.gateway_id=new.gateway_id
        and t.external_id=v_external
        and (new.user_id is null or t.user_id=new.user_id)
      order by t.created_at desc
      limit 1;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists gateway_webhook_event_context_trg on public.gateway_webhook_events;
create trigger gateway_webhook_event_context_trg
before insert or update of gateway_id,payload,transaction_id
on public.gateway_webhook_events
for each row execute function public.link_gateway_webhook_event_context();

update public.gateway_webhook_events
set gateway_id=gateway_id
where gateway_id is not null
  and (user_id is null or organization_id is null or transaction_id is null);

create index if not exists gateway_webhook_events_org_received_idx
  on public.gateway_webhook_events(organization_id,received_at desc)
  where organization_id is not null;

create index if not exists gateway_webhook_events_transaction_received_idx
  on public.gateway_webhook_events(transaction_id,received_at desc)
  where transaction_id is not null;

create index if not exists gateway_transactions_org_checkout_metadata_idx
  on public.gateway_transactions(organization_id,(metadata->>'checkout_session_id'),created_at desc)
  where metadata ? 'checkout_session_id';

create or replace function public.checkout_operations_page_v1(
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_status text default null,
  p_query text default null,
  p_funnel_id text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_items jsonb:='[]'::jsonb;
  v_metrics jsonb:='{}'::jsonb;
  v_has_more boolean:=false;
  v_next_created timestamptz;
  v_next_id uuid;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  select jsonb_build_object(
    'total',count(*),
    'active',count(*) filter(where lower(c.status) in ('started','pending','processing')),
    'completed',count(*) filter(where lower(c.status)='completed'),
    'abandoned',count(*) filter(where lower(c.status)='abandoned'),
    'failed',count(*) filter(where lower(c.status)='failed'),
    'amount',coalesce(sum(c.amount),0)
  )
  into v_metrics
  from public.checkout_sessions c
  left join public.funnels f on f.id=c.funnel_id and f.organization_id=c.organization_id
  left join public.products p on p.id=c.product_id and p.organization_id=c.organization_id
  where c.organization_id=v_org
    and (p_funnel_id is null or p_funnel_id='' or c.funnel_id=p_funnel_id)
    and (
      p_query is null or btrim(p_query)='' or
      lower(concat_ws(' ',
        c.id::text,
        c.customer->>'name',
        c.customer->>'full_name',
        c.customer->>'email',
        c.customer->>'phone',
        f.nome,p.name,
        c.attribution->>'source',
        c.attribution->>'campaign'
      )) like '%'||lower(btrim(p_query))||'%'
    );

  with candidates as (
    select
      c.id,c.funnel_id,c.product_id,c.status,c.currency,c.amount,c.customer,c.attribution,c.metadata,
      c.created_at,c.updated_at,c.abandoned_at,c.completed_at,c.recovery_count,c.recovery_status,
      f.nome as funnel_name,
      p.name as product_name,
      tx.id as transaction_id,
      tx.status as payment_status,
      tx.gateway_id,
      g.display_name as gateway_name,
      g.provider as gateway_provider,
      tx.external_id as provider_external_id,
      tx.failure_code,
      tx.error_message as payment_error
    from public.checkout_sessions c
    left join public.funnels f on f.id=c.funnel_id and f.organization_id=c.organization_id
    left join public.products p on p.id=c.product_id and p.organization_id=c.organization_id
    left join lateral (
      select t.id,t.status,t.gateway_id,t.external_id,t.failure_code,t.error_message
      from public.gateway_transactions t
      where t.organization_id=c.organization_id
        and t.metadata->>'checkout_session_id'=c.id::text
      order by t.created_at desc,t.id desc
      limit 1
    ) tx on true
    left join public.gateways g on g.id=tx.gateway_id and g.organization_id=c.organization_id
    where c.organization_id=v_org
      and (p_status is null or p_status='' or p_status='all' or lower(c.status)=lower(p_status))
      and (p_funnel_id is null or p_funnel_id='' or c.funnel_id=p_funnel_id)
      and (
        p_query is null or btrim(p_query)='' or
        lower(concat_ws(' ',
          c.id::text,
          c.customer->>'name',
          c.customer->>'full_name',
          c.customer->>'email',
          c.customer->>'phone',
          f.nome,p.name,
          c.attribution->>'source',
          c.attribution->>'campaign',
          tx.external_id,
          g.display_name,
          g.provider
        )) like '%'||lower(btrim(p_query))||'%'
      )
      and (
        p_cursor_created_at is null or p_cursor_id is null or
        (c.created_at,c.id)<(p_cursor_created_at,p_cursor_id)
      )
    order by c.created_at desc,c.id desc
    limit v_limit+1
  ),
  page as (
    select * from candidates
    order by created_at desc,id desc
    limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    (select count(*)>v_limit from candidates),
    (select p.created_at from page p order by p.created_at asc,p.id asc limit 1),
    (select p.id from page p order by p.created_at asc,p.id asc limit 1)
  into v_items,v_has_more,v_next_created,v_next_id;

  return jsonb_build_object(
    'items',v_items,
    'metrics',v_metrics,
    'has_more',coalesce(v_has_more,false),
    'next_cursor',case when v_has_more and v_next_id is not null
      then jsonb_build_object('created_at',v_next_created,'id',v_next_id)
      else null end
  );
end;
$function$;

create or replace function public.checkout_operations_detail_v1(
  p_checkout_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_checkout public.checkout_sessions%rowtype;
  v_email text;
  v_transactions jsonb;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  select * into v_checkout
  from public.checkout_sessions
  where id=p_checkout_id and organization_id=v_org;

  if not found then raise exception using errcode='P0002',message='checkout_not_found'; end if;
  v_email:=nullif(lower(trim(coalesce(v_checkout.customer->>'email',''))),'');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'status',t.status,'gateway_id',t.gateway_id,'gateway_name',g.display_name,'gateway_provider',g.provider,
    'external_id',t.external_id,'amount',t.amount,'currency',t.currency,'attempt_count',t.attempt_count,
    'failure_code',t.failure_code,'error_message',t.error_message,'routing_metadata',t.routing_metadata,
    'created_at',t.created_at,'updated_at',t.updated_at,'completed_at',t.completed_at
  ) order by t.created_at desc),'[]'::jsonb)
  into v_transactions
  from public.gateway_transactions t
  left join public.gateways g on g.id=t.gateway_id and g.organization_id=t.organization_id
  where t.organization_id=v_org
    and t.metadata->>'checkout_session_id'=p_checkout_id::text;

  return jsonb_build_object(
    'checkout',
      (to_jsonb(v_checkout)-'idempotency_key')
      || jsonb_build_object(
        'funnel_name',(select f.nome from public.funnels f where f.id=v_checkout.funnel_id and f.organization_id=v_org limit 1),
        'product_name',(select p.name from public.products p where p.id=v_checkout.product_id and p.organization_id=v_org limit 1)
      ),
    'transactions',v_transactions,
    'attempts',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from public.gateway_payment_attempts a
      where a.organization_id=v_org and a.transaction_id in (
        select t.id from public.gateway_transactions t
        where t.organization_id=v_org and t.metadata->>'checkout_session_id'=p_checkout_id::text
      )
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from public.checkout_events e
      where e.organization_id=v_org and e.checkout_id=p_checkout_id
    ),'[]'::jsonb),
    'webhooks',coalesce((
      select jsonb_agg(to_jsonb(w) - 'payload' order by w.received_at desc)
      from public.gateway_webhook_events w
      where w.organization_id=v_org and w.transaction_id in (
        select t.id from public.gateway_transactions t
        where t.organization_id=v_org and t.metadata->>'checkout_session_id'=p_checkout_id::text
      )
    ),'[]'::jsonb),
    'recovery',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.recovery_events r
      where r.user_id=v_checkout.user_id and r.checkout_id=p_checkout_id
    ),'[]'::jsonb),
    'sales',coalesce((
      select jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.created_at desc nulls last)
      from public.sales s
      where s.organization_id=v_org and s.checkout_id=p_checkout_id
    ),'[]'::jsonb),
    'conversations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'status',c.status,'priority',c.priority,'primary_channel',c.primary_channel,
        'buyer_name',c.buyer_name,'buyer_email',c.buyer_email,'unread_count',c.unread_count,
        'last_message_at',c.last_message_at,'updated_at',c.updated_at
      ) order by c.updated_at desc)
      from public.crm_conversations c
      where c.user_id=v_checkout.user_id
        and c.funnel_id is not distinct from v_checkout.funnel_id
        and (
          (v_email is not null and lower(c.buyer_email)=v_email)
          or c.transaction_id in (
            select t.id::text from public.gateway_transactions t
            where t.organization_id=v_org and t.metadata->>'checkout_session_id'=p_checkout_id::text
          )
        )
    ),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.payment_operations_page_v1(
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_status text default null,
  p_query text default null,
  p_funnel_id text default null,
  p_gateway_id text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_items jsonb:='[]'::jsonb;
  v_metrics jsonb:='{}'::jsonb;
  v_has_more boolean:=false;
  v_next_created timestamptz;
  v_next_id uuid;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  select jsonb_build_object(
    'transactions',count(*),
    'gross_volume',coalesce(sum(t.amount),0),
    'approved_count',count(*) filter(where t.status='approved'),
    'approved_volume',coalesce(sum(t.amount) filter(where t.status='approved'),0),
    'pending_count',count(*) filter(where t.status in ('created','pending')),
    'failed_count',count(*) filter(where t.status='failed'),
    'refunded_count',count(*) filter(where t.status='refunded'),
    'chargeback_count',count(*) filter(where t.status='chargeback')
  )
  into v_metrics
  from public.gateway_transactions t
  left join public.gateways g on g.id=t.gateway_id and g.organization_id=t.organization_id
  left join public.funnels f on f.id=t.funnel_id and f.organization_id=t.organization_id
  left join public.products p on p.id=t.product_id and p.organization_id=t.organization_id
  where t.organization_id=v_org
    and (p_funnel_id is null or p_funnel_id='' or t.funnel_id=p_funnel_id)
    and (p_gateway_id is null or p_gateway_id='' or t.gateway_id=p_gateway_id)
    and (
      p_query is null or btrim(p_query)='' or
      lower(concat_ws(' ',
        t.id::text,t.external_id,t.customer->>'name',t.customer->>'full_name',t.customer->>'email',t.customer->>'phone',
        g.display_name,g.provider,f.nome,p.name,t.failure_code
      )) like '%'||lower(btrim(p_query))||'%'
    );

  with candidates as (
    select
      t.id,t.funnel_id,t.product_id,t.gateway_id,t.external_id,t.amount,t.currency,t.status,t.customer,
      t.error_message,t.failure_code,t.attempt_count,t.routing_metadata,t.created_at,t.updated_at,t.completed_at,
      f.nome as funnel_name,p.name as product_name,g.display_name as gateway_name,g.provider as gateway_provider,g.environment as gateway_environment,
      la.status as last_attempt_status,la.failure_class as last_failure_class,la.decision_reason as last_decision_reason,
      la.duration_ms as last_duration_ms,la.provider_request_id as last_provider_request_id
    from public.gateway_transactions t
    left join public.funnels f on f.id=t.funnel_id and f.organization_id=t.organization_id
    left join public.products p on p.id=t.product_id and p.organization_id=t.organization_id
    left join public.gateways g on g.id=t.gateway_id and g.organization_id=t.organization_id
    left join lateral (
      select a.status,a.failure_class,a.decision_reason,a.duration_ms,a.provider_request_id
      from public.gateway_payment_attempts a
      where a.organization_id=t.organization_id and a.transaction_id=t.id
      order by a.attempt_order desc,a.created_at desc
      limit 1
    ) la on true
    where t.organization_id=v_org
      and (p_status is null or p_status='' or p_status='all' or t.status=lower(p_status))
      and (p_funnel_id is null or p_funnel_id='' or t.funnel_id=p_funnel_id)
      and (p_gateway_id is null or p_gateway_id='' or t.gateway_id=p_gateway_id)
      and (
        p_query is null or btrim(p_query)='' or
        lower(concat_ws(' ',
          t.id::text,t.external_id,t.customer->>'name',t.customer->>'full_name',t.customer->>'email',t.customer->>'phone',
          g.display_name,g.provider,f.nome,p.name,t.failure_code,la.failure_class,la.decision_reason
        )) like '%'||lower(btrim(p_query))||'%'
      )
      and (
        p_cursor_created_at is null or p_cursor_id is null or
        (t.created_at,t.id)<(p_cursor_created_at,p_cursor_id)
      )
    order by t.created_at desc,t.id desc
    limit v_limit+1
  ),
  page as (
    select * from candidates order by created_at desc,id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    (select count(*)>v_limit from candidates),
    (select p.created_at from page p order by p.created_at asc,p.id asc limit 1),
    (select p.id from page p order by p.created_at asc,p.id asc limit 1)
  into v_items,v_has_more,v_next_created,v_next_id;

  return jsonb_build_object(
    'items',v_items,
    'metrics',v_metrics,
    'has_more',coalesce(v_has_more,false),
    'next_cursor',case when v_has_more and v_next_id is not null
      then jsonb_build_object('created_at',v_next_created,'id',v_next_id)
      else null end
  );
end;
$function$;

create or replace function public.payment_operations_detail_v1(
  p_transaction_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_tx public.gateway_transactions%rowtype;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  select * into v_tx from public.gateway_transactions
  where id=p_transaction_id and organization_id=v_org;
  if not found then raise exception using errcode='P0002',message='transaction_not_found'; end if;

  return jsonb_build_object(
    'transaction',
      (to_jsonb(v_tx)-'idempotency_key')
      || jsonb_build_object(
        'funnel_name',(select f.nome from public.funnels f where f.id=v_tx.funnel_id and f.organization_id=v_org limit 1),
        'product_name',(select p.name from public.products p where p.id=v_tx.product_id and p.organization_id=v_org limit 1),
        'gateway',(select jsonb_build_object('id',g.id,'name',g.display_name,'provider',g.provider,'environment',g.environment,'status',g.status)
                   from public.gateways g where g.id=v_tx.gateway_id and g.organization_id=v_org limit 1)
      ),
    'attempts',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.attempt_order desc,a.created_at desc)
      from public.gateway_payment_attempts a
      where a.organization_id=v_org and a.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'webhooks',coalesce((
      select jsonb_agg((to_jsonb(w)-'payload')||jsonb_build_object('payload_summary',
        jsonb_strip_nulls(jsonb_build_object(
          'status',coalesce(w.payload->>'status',w.payload#>>'{data,status}'),
          'external_id',coalesce(w.payload->>'external_id',w.payload->>'transaction_id',w.payload#>>'{data,external_id}',w.payload#>>'{data,transaction_id}')
        ))) order by w.received_at desc)
      from public.gateway_webhook_events w
      where w.organization_id=v_org and w.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'refunds',coalesce((
      select jsonb_agg(to_jsonb(r)-'idempotency_key' order by r.created_at desc)
      from public.gateway_refunds r
      where r.user_id=v_tx.user_id and r.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'disputes',coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at desc)
      from public.disputes d
      where d.organization_id=v_org and d.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'reconciliation',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.reconciliation_items r
      where r.organization_id=v_org and r.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'audit',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from public.transaction_audit_events a
      where a.organization_id=v_org and a.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'financial_journals',coalesce((
      select jsonb_agg(
        to_jsonb(j)||jsonb_build_object('entries',coalesce((
          select jsonb_agg(to_jsonb(e) order by e.created_at)
          from public.gateway_financial_entries e
          where e.journal_id=j.id and e.user_id=v_tx.user_id
        ),'[]'::jsonb))
        order by j.created_at desc
      )
      from public.gateway_financial_journals j
      where j.user_id=v_tx.user_id and j.transaction_id=p_transaction_id
    ),'[]'::jsonb),
    'sale',(
      select to_jsonb(s) from public.sales s
      where s.organization_id=v_org and s.transaction_id=p_transaction_id
      order by s.occurred_at desc nulls last,s.created_at desc nulls last
      limit 1
    ),
    'checkout',(
      select to_jsonb(c)-'idempotency_key'
      from public.checkout_sessions c
      where c.organization_id=v_org
        and c.id=nullif(v_tx.metadata->>'checkout_session_id','')::uuid
      limit 1
    ),
    'conversations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'status',c.status,'priority',c.priority,'primary_channel',c.primary_channel,
        'buyer_name',c.buyer_name,'buyer_email',c.buyer_email,'unread_count',c.unread_count,
        'last_message_at',c.last_message_at,'updated_at',c.updated_at
      ) order by c.updated_at desc)
      from public.crm_conversations c
      where c.user_id=v_tx.user_id
        and (c.transaction_id=p_transaction_id::text or c.transaction_id=v_tx.external_id)
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.checkout_operations_page_v1(integer,timestamptz,uuid,text,text,text) from public,anon;
revoke all on function public.checkout_operations_detail_v1(uuid) from public,anon;
revoke all on function public.payment_operations_page_v1(integer,timestamptz,uuid,text,text,text,text) from public,anon;
revoke all on function public.payment_operations_detail_v1(uuid) from public,anon;

grant execute on function public.checkout_operations_page_v1(integer,timestamptz,uuid,text,text,text) to authenticated;
grant execute on function public.checkout_operations_detail_v1(uuid) to authenticated;
grant execute on function public.payment_operations_page_v1(integer,timestamptz,uuid,text,text,text,text) to authenticated;
grant execute on function public.payment_operations_detail_v1(uuid) to authenticated;
