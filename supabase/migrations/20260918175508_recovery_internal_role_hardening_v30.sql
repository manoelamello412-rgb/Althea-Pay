CREATE OR REPLACE FUNCTION public.claim_checkout_recovery_events_v1(p_limit integer DEFAULT 25)
 RETURNS TABLE(event_id uuid, user_id uuid, organization_id uuid, checkout_id uuid, funnel_id text, funnel_url text, product_id text, amount numeric, currency text, customer jsonb, checkout_metadata jsonb, recovery_count integer, event_attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,25),100));
begin

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

revoke all on function public.claim_checkout_recovery_events_v1(p_limit integer) from public,anon,authenticated;
grant execute on function public.claim_checkout_recovery_events_v1(p_limit integer) to service_role;

revoke all on function public.enqueue_checkout_recovery_events(p_limit integer) from public,anon,authenticated;
grant execute on function public.enqueue_checkout_recovery_events(p_limit integer) to service_role;

revoke all on function public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text, p_conversation_id uuid, p_outbox_id uuid, p_error text, p_retry_seconds integer) from public,anon,authenticated;
grant execute on function public.update_checkout_recovery_worker_v1(p_event_id uuid, p_status text, p_channel text, p_conversation_id uuid, p_outbox_id uuid, p_error text, p_retry_seconds integer) to service_role;