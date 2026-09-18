alter table public.recovery_events
  add column if not exists organization_id uuid,
  add column if not exists channel text,
  add column if not exists conversation_id uuid,
  add column if not exists outbox_id uuid,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

update public.recovery_events r
set organization_id=c.organization_id
from public.checkout_sessions c
where r.checkout_id=c.id and r.organization_id is null;

CREATE INDEX IF NOT EXISTS recovery_events_org_status_next_idx ON public.recovery_events USING btree (organization_id, status, next_attempt_at, created_at) WHERE (organization_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS recovery_events_outbox_idx ON public.recovery_events USING btree (outbox_id) WHERE (outbox_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.claim_checkout_recovery_events_v1(p_limit integer DEFAULT 25)
 RETURNS TABLE(event_id uuid, user_id uuid, organization_id uuid, checkout_id uuid, funnel_id text, funnel_url text, product_id text, amount numeric, currency text, customer jsonb, checkout_metadata jsonb, recovery_count integer, event_attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,25),100));
begin
  if auth.role()<>'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'forbidden';
  end if;

  return query
  with candidates as (
    select r.id
    from public.recovery_events r
    join public.checkout_sessions c on c.id=r.checkout_id
    where r.event_type='recovery_due'
      and r.status='queued'
      and (r.next_attempt_at is null or r.next_attempt_at<=now())
      and c.status='abandoned'
      and c.completed_at is null
      and c.recovery_count<5
    order by r.created_at asc
    for update of r skip locked
    limit v_limit
  ),
  claimed as (
    update public.recovery_events r
    set status='processing',
        attempt_count=r.attempt_count+1,
        updated_at=now(),
        last_error=null
    from candidates c
    where r.id=c.id
    returning r.*
  ),
  checkout_update as (
    update public.checkout_sessions c
    set recovery_status='processing',updated_at=now()
    where c.id in (select cl.checkout_id from claimed cl)
    returning c.id
  )
  select
    cl.id,
    cl.user_id,
    coalesce(cl.organization_id,cs.organization_id),
    cs.id,
    cs.funnel_id,
    f.url,
    cs.product_id,
    cs.amount,
    cs.currency,
    cs.customer,
    cs.metadata,
    cs.recovery_count,
    cl.attempt_count
  from claimed cl
  join public.checkout_sessions cs on cs.id=cl.checkout_id
  left join public.funnels f on f.id=cs.funnel_id and f.organization_id=cs.organization_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_checkout_recovery_events(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_count integer;
begin
  if auth.role()<>'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'forbidden';
  end if;

  with candidates as (
    select c.id,c.user_id,c.organization_id,c.recovery_count
    from public.checkout_sessions c
    join public.platform_settings ps on ps.user_id=c.user_id
    where c.status='abandoned'
      and c.completed_at is null
      and c.recovery_count<5
      and c.recovery_status in ('pending','queued','blocked_no_channel')
      and (c.recovery_next_at is null or c.recovery_next_at<=now())
      and coalesce((ps.data#>>'{recovery,cartAutomation}')::boolean,false)=true
    order by c.abandoned_at asc nulls first,c.created_at asc
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ),
  upserted as (
    insert into public.recovery_events(
      user_id,organization_id,checkout_id,event_type,status,payload,next_attempt_at,updated_at
    )
    select
      c.user_id,c.organization_id,c.id,'recovery_due','queued',
      jsonb_build_object('checkout_id',c.id,'source','automatic_cart_recovery','attempt',c.recovery_count+1),
      now(),now()
    from candidates c
    on conflict(checkout_id,event_type) do update
      set user_id=excluded.user_id,
          organization_id=excluded.organization_id,
          status='queued',
          payload=excluded.payload,
          processed_at=null,
          next_attempt_at=now(),
          last_error=null,
          updated_at=now()
    returning checkout_id
  )
  update public.checkout_sessions c
  set recovery_status='queued',
      recovery_next_at=now(),
      updated_at=now()
  where c.id in (select checkout_id from upserted);

  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_checkout_recovery_recovered_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if coalesce(new.recovery_count,0)>0
     and (new.status='completed' or new.completed_at is not null)
     and not (old.status='completed' or old.completed_at is not null) then
    new.recovery_status:='recovered';
    new.recovery_next_at:=null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recovery_operations_v1(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_days integer:=greatest(1,least(coalesce(p_days,7),90));
  v_start timestamptz:=now()-make_interval(days=>greatest(1,least(coalesce(p_days,7),90)));
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  return jsonb_build_object(
    'metrics',(
      select jsonb_build_object(
        'abandoned',count(*) filter(where c.status='abandoned'),
        'abandoned_value',coalesce(sum(c.amount) filter(where c.status='abandoned'),0),
        'queued',count(*) filter(where c.recovery_status in ('queued','processing','queued_delivery','processing_delivery')),
        'sent',count(*) filter(where c.recovery_status='sent'),
        'recovered',count(*) filter(where c.recovery_status='recovered'),
        'recovered_value',coalesce(sum(c.amount) filter(where c.recovery_status='recovered'),0),
        'blocked',count(*) filter(where c.recovery_status in ('blocked_consent','blocked_no_channel','blocked_no_destination')),
        'failed',count(*) filter(where c.recovery_status in ('delivery_failed','dead_letter'))
      )
      from public.checkout_sessions c
      where c.organization_id=v_org and c.created_at>=v_start
    ),
    'automation',coalesce((
      select ps.data->'recovery'
      from public.platform_settings ps
      where ps.user_id=v_uid
      limit 1
    ),'{}'::jsonb),
    'channel_accounts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'channel',a.channel,'provider',a.provider,'display_name',a.display_name,'status',a.status
      ) order by a.channel,a.display_name)
      from public.crm_channel_accounts a
      where a.user_id=v_uid and a.status='active'
    ),'[]'::jsonb),
    'crm_opportunities',coalesce((
      select jsonb_agg(to_jsonb(o) order by o.priority desc,o.received_at desc)
      from public.crm_recovery_opportunities(least(v_days,30)) o
    ),'[]'::jsonb),
    'checkouts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'checkout_id',c.id,
        'funnel_id',c.funnel_id,
        'funnel_name',f.nome,
        'product_id',c.product_id,
        'product_name',p.name,
        'status',c.status,
        'amount',c.amount,
        'currency',c.currency,
        'customer',c.customer,
        'recovery_status',c.recovery_status,
        'recovery_count',c.recovery_count,
        'recovery_last_sent_at',c.recovery_last_sent_at,
        'recovery_next_at',c.recovery_next_at,
        'abandoned_at',c.abandoned_at,
        'created_at',c.created_at,
        'event_status',r.status,
        'event_attempt_count',r.attempt_count,
        'channel',r.channel,
        'conversation_id',r.conversation_id,
        'outbox_id',r.outbox_id,
        'last_error',coalesce(o.last_error,r.last_error),
        'outbox_status',o.status,
        'outbox_updated_at',o.updated_at
      ) order by coalesce(c.abandoned_at,c.updated_at) desc)
      from public.checkout_sessions c
      left join public.funnels f on f.id=c.funnel_id and f.organization_id=c.organization_id
      left join public.products p on p.id=c.product_id and p.organization_id=c.organization_id
      left join public.recovery_events r on r.checkout_id=c.id and r.event_type='recovery_due'
      left join public.crm_channel_message_outbox o on o.id=r.outbox_id
      where c.organization_id=v_org
        and c.created_at>=v_start
        and (c.status='abandoned' or c.recovery_count>0 or c.recovery_status is not null)
      limit 200
    ),'[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.recovery_operator_requeue_checkout_v1(p_checkout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_checkout public.checkout_sessions%rowtype;
  v_event_id uuid;
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  select * into v_checkout
  from public.checkout_sessions
  where id=p_checkout_id and organization_id=v_org
  for update;

  if not found then raise exception using errcode='P0002',message='checkout_not_found'; end if;
  if v_checkout.status='completed' or v_checkout.completed_at is not null then
    raise exception using errcode='22023',message='checkout_already_completed';
  end if;
  if v_checkout.recovery_count>=5 then
    raise exception using errcode='22023',message='recovery_attempt_limit_reached';
  end if;

  insert into public.recovery_events(
    user_id,organization_id,checkout_id,event_type,status,payload,next_attempt_at,updated_at
  ) values(
    v_checkout.user_id,v_checkout.organization_id,v_checkout.id,'recovery_due','queued',
    jsonb_build_object('checkout_id',v_checkout.id,'source','operator_requeue','requested_by',v_uid,'attempt',v_checkout.recovery_count+1),
    now(),now()
  )
  on conflict(checkout_id,event_type) do update
    set status='queued',
        payload=excluded.payload,
        processed_at=null,
        next_attempt_at=now(),
        last_error=null,
        updated_at=now()
  returning id into v_event_id;

  update public.checkout_sessions
  set recovery_status='queued',recovery_next_at=now(),updated_at=now()
  where id=v_checkout.id;

  return jsonb_build_object('checkout_id',v_checkout.id,'event_id',v_event_id,'status','queued');
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_checkout_recovery_from_outbox_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_checkout_text text;
  v_checkout_id uuid;
begin
  v_checkout_text:=coalesce(new.metadata->>'recovery_checkout_id','');
  if v_checkout_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_checkout_id:=v_checkout_text::uuid;

  if new.status='sent' then
    update public.checkout_sessions
    set recovery_status='sent',
        recovery_last_sent_at=coalesce(new.sent_at,now()),
        recovery_next_at=null,
        updated_at=now()
    where id=v_checkout_id;

    update public.recovery_events
    set status='sent',
        outbox_id=new.id,
        processed_at=coalesce(new.sent_at,now()),
        last_error=null,
        updated_at=now()
    where checkout_id=v_checkout_id and event_type='recovery_due';

  elsif new.status in ('failed','dead_letter') then
    update public.checkout_sessions
    set recovery_status='delivery_failed',
        recovery_next_at=null,
        updated_at=now()
    where id=v_checkout_id;

    update public.recovery_events
    set status=case when new.status='dead_letter' then 'dead_letter' else 'delivery_failed' end,
        outbox_id=new.id,
        processed_at=case when new.status='dead_letter' then now() else processed_at end,
        last_error=left(coalesce(new.last_error,new.status),2000),
        updated_at=now()
    where checkout_id=v_checkout_id and event_type='recovery_due';

  elsif new.status in ('queued','processing') then
    update public.checkout_sessions
    set recovery_status=case when new.status='processing' then 'processing_delivery' else 'queued_delivery' end,
        updated_at=now()
    where id=v_checkout_id;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text DEFAULT NULL::text, p_conversation_id uuid DEFAULT NULL::uuid, p_outbox_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text, p_retry_seconds integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_event public.recovery_events%rowtype;
  v_status text:=lower(btrim(coalesce(p_status,'')));
  v_retry integer:=greatest(30,least(coalesce(p_retry_seconds,300),86400));
begin
  if auth.role()<>'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'forbidden';
  end if;
  if v_status not in ('outbox_queued','blocked_consent','blocked_no_channel','blocked_no_destination','retry','dead_letter') then
    raise exception 'invalid_recovery_worker_status';
  end if;

  select * into v_event from public.recovery_events where id=p_event_id for update;
  if not found then raise exception 'recovery_event_not_found'; end if;

  if v_status='outbox_queued' then
    update public.recovery_events
    set status='outbox_queued',
        channel=nullif(btrim(coalesce(p_channel,'')),''),
        conversation_id=p_conversation_id,
        outbox_id=p_outbox_id,
        next_attempt_at=null,
        last_error=null,
        updated_at=now()
    where id=p_event_id;

    update public.checkout_sessions
    set recovery_status='queued_delivery',
        recovery_count=recovery_count+1,
        recovery_next_at=null,
        updated_at=now()
    where id=v_event.checkout_id;

  elsif v_status='retry' then
    update public.recovery_events
    set status='queued',
        next_attempt_at=now()+make_interval(secs=>v_retry),
        last_error=left(coalesce(p_error,'recovery_worker_retry'),2000),
        updated_at=now()
    where id=p_event_id;

    update public.checkout_sessions
    set recovery_status='queued',
        recovery_next_at=now()+make_interval(secs=>v_retry),
        updated_at=now()
    where id=v_event.checkout_id;

  else
    update public.recovery_events
    set status=v_status,
        channel=nullif(btrim(coalesce(p_channel,'')),''),
        conversation_id=p_conversation_id,
        outbox_id=p_outbox_id,
        processed_at=now(),
        next_attempt_at=case when v_status='blocked_no_channel' then now()+interval '1 hour' else null end,
        last_error=left(coalesce(p_error,v_status),2000),
        updated_at=now()
    where id=p_event_id;

    update public.checkout_sessions
    set recovery_status=v_status,
        recovery_next_at=case when v_status='blocked_no_channel' then now()+interval '1 hour' else null end,
        updated_at=now()
    where id=v_event.checkout_id;
  end if;

  return jsonb_build_object(
    'event_id',p_event_id,
    'checkout_id',v_event.checkout_id,
    'status',v_status,
    'outbox_id',p_outbox_id
  );
end;
$function$;

drop trigger if exists checkout_recovery_recovered_trg on public.checkout_sessions;
CREATE TRIGGER checkout_recovery_recovered_trg BEFORE UPDATE OF status, completed_at ON checkout_sessions FOR EACH ROW EXECUTE FUNCTION mark_checkout_recovery_recovered_v1();

drop trigger if exists crm_outbox_checkout_recovery_sync_trg on public.crm_channel_message_outbox;
CREATE TRIGGER crm_outbox_checkout_recovery_sync_trg AFTER INSERT OR UPDATE OF status, sent_at, failed_at, last_error ON crm_channel_message_outbox FOR EACH ROW EXECUTE FUNCTION sync_checkout_recovery_from_outbox_v1();

revoke all on function public.claim_checkout_recovery_events_v1(p_limit integer) from public,anon,authenticated;
grant execute on function public.claim_checkout_recovery_events_v1(p_limit integer) to service_role;

revoke all on function public.enqueue_checkout_recovery_events(p_limit integer) from public,anon,authenticated;
grant execute on function public.enqueue_checkout_recovery_events(p_limit integer) to service_role;

revoke all on function public.recovery_operations_v1(p_days integer) from public,anon;
grant execute on function public.recovery_operations_v1(p_days integer) to authenticated;

revoke all on function public.recovery_operator_requeue_checkout_v1(p_checkout_id uuid) from public,anon;
grant execute on function public.recovery_operator_requeue_checkout_v1(p_checkout_id uuid) to authenticated;

revoke all on function public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text, p_conversation_id uuid, p_outbox_id uuid, p_error text, p_retry_seconds integer) from public,anon,authenticated;
grant execute on function public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text, p_conversation_id uuid, p_outbox_id uuid, p_error text, p_retry_seconds integer) to service_role;
