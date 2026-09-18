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
      from (
        select *
        from public.crm_recovery_opportunities(least(v_days,30))
        order by priority desc,received_at desc
        limit 100
      ) o
    ),'[]'::jsonb),
    'checkouts',coalesce((
      select jsonb_agg(x.item order by x.sort_at desc)
      from (
        select
          jsonb_build_object(
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
          ) as item,
          coalesce(c.abandoned_at,c.updated_at) as sort_at
        from public.checkout_sessions c
        left join public.funnels f on f.id=c.funnel_id and f.organization_id=c.organization_id
        left join public.products p on p.id=c.product_id and p.organization_id=c.organization_id
        left join public.recovery_events r on r.checkout_id=c.id and r.event_type='recovery_due'
        left join public.crm_channel_message_outbox o on o.id=r.outbox_id
        where c.organization_id=v_org
          and c.created_at>=v_start
          and (c.status='abandoned' or c.recovery_count>0 or c.recovery_status is not null)
        order by sort_at desc
        limit 200
      ) x
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.recovery_operations_v1(integer) from public,anon;
grant execute on function public.recovery_operations_v1(integer) to authenticated;
