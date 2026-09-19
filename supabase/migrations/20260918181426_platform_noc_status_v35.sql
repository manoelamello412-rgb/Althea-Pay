
create or replace function public.health_database_ping_v1()
returns jsonb
language sql
stable
set search_path=pg_catalog
as $function$
  select jsonb_build_object(
    'ok',true,
    'database','ok',
    'database_time',clock_timestamp()
  );
$function$;

revoke all on function public.health_database_ping_v1() from public;
grant execute on function public.health_database_ping_v1() to anon,authenticated,service_role;

create or replace function public.platform_noc_status_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,cron,pg_catalog
as $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception using errcode='42501',message='unauthorized';
  end if;

  select default_organization_id into v_org
  from public.profiles
  where id=v_uid;

  if v_org is null or not private.has_org_role(
    v_org,
    array['owner','admin','manager','operator','supervisor']
  ) then
    raise exception using errcode='42501',message='forbidden';
  end if;

  return (
    with
    org_users as (
      select om.user_id
      from public.organization_members om
      where om.organization_id=v_org
    ),
    latest_run as (
      select distinct on (j.jobid)
        j.jobid,
        j.jobname,
        j.schedule,
        j.active,
        r.status as run_status,
        r.start_time,
        r.end_time
      from cron.job j
      left join cron.job_run_details r on r.jobid=j.jobid
      order by j.jobid,r.start_time desc nulls last,r.runid desc nulls last
    ),
    cron_health as (
      select
        lr.*,
        case
          when lr.schedule='* * * * *' then 180
          when lr.schedule='*/2 * * * *' then 300
          when lr.schedule='*/5 * * * *' then 720
          when lr.schedule='0 * * * *' then 7500
          when lr.schedule='0 9 * * *' then 93600
          else null
        end as expected_max_age_seconds
      from latest_run lr
      where lr.jobname like 'althea-%'
         or lr.jobname like 'crm-%'
         or lr.jobname like 'iara-%'
    ),
    cron_classified as (
      select
        ch.*,
        case
          when ch.active is not true then 'disabled'
          when ch.run_status is null then 'unknown'
          when ch.run_status<>'succeeded' then 'failed'
          when ch.expected_max_age_seconds is not null
            and extract(epoch from (now()-coalesce(ch.end_time,ch.start_time)))>ch.expected_max_age_seconds
            then 'stale'
          else 'healthy'
        end as health
      from cron_health ch
    ),
    latest_gateway_health as (
      select distinct on (gh.user_id,gh.gateway_name)
        gh.user_id,
        gh.gateway_id,
        gh.gateway_name,
        gh.is_healthy,
        gh.latency_ms,
        gh.consecutive_failures,
        gh.circuit_state,
        gh.checked_at
      from public.gateway_health_snapshots gh
      where gh.user_id in (select user_id from org_users)
      order by gh.user_id,gh.gateway_name,gh.checked_at desc
    ),
    queue_metrics as (
      select jsonb_build_object(
        'integration_backlog',(
          select count(*)
          from public.integration_events e
          where e.organization_id=v_org
            and e.processed_at is null
            and e.created_at<now()-interval '5 minutes'
        ),
        'integration_errors_24h',(
          select count(*)
          from public.integration_events e
          where e.organization_id=v_org
            and e.created_at>=now()-interval '24 hours'
            and (e.error_message is not null or lower(e.status) in ('failed','error','dead_letter'))
        ),
        'webhook_backlog',(
          select count(*)
          from public.webhook_deliveries w
          where w.user_id in (select user_id from org_users)
            and w.delivered_at is null
            and w.created_at<now()-interval '5 minutes'
            and lower(w.status) not in ('delivered','succeeded','success')
        ),
        'webhook_errors_24h',(
          select count(*)
          from public.webhook_deliveries w
          where w.user_id in (select user_id from org_users)
            and w.created_at>=now()-interval '24 hours'
            and (w.error_message is not null or lower(w.status) in ('failed','error','dead_letter'))
        ),
        'crm_outbox_backlog',(
          select count(*)
          from public.crm_channel_message_outbox o
          where o.user_id in (select user_id from org_users)
            and o.status in ('queued','processing')
            and o.created_at<now()-interval '5 minutes'
        ),
        'crm_outbox_dead_letters',(
          select count(*)
          from public.crm_channel_message_outbox o
          where o.user_id in (select user_id from org_users)
            and o.status='dead_letter'
        ),
        'event_dead_letters',(
          select count(*)
          from public.event_dead_letters d
          where d.user_id in (select user_id from org_users)
            and d.resolved_at is null
        ),
        'iara_dead_letters',(
          select count(*)
          from public.iara_queue_dead_letters d
          where d.tenant_id=v_org
        ),
        'gateway_recovery_overdue',(
          select count(*)
          from public.gateway_recovery_queue q
          where q.user_id in (select user_id from org_users)
            and lower(q.status) in ('queued','retry','processing')
            and q.next_retry_at<now()-interval '5 minutes'
        ),
        'checkout_recovery_failures',(
          select count(*)
          from public.recovery_events r
          where r.organization_id=v_org
            and r.status in ('delivery_failed','dead_letter')
        ),
        'command_failures_24h',(
          select count(*)
          from public.funnel_command_batches b
          where b.organization_id=v_org
            and b.requested_at>=now()-interval '24 hours'
            and b.status in ('failed','preflight_failed','partial')
        ),
        'command_stale',(
          select count(*)
          from public.funnel_command_batches b
          where b.organization_id=v_org
            and b.status in ('queued','running')
            and b.updated_at<now()-interval '10 minutes'
        ),
        'open_drifts',(
          select count(*)
          from public.funnel_control_drift_events d
          where d.organization_id=v_org
            and d.status='open'
        )
      ) as value
    ),
    readiness as (
      select
        count(*) filter(where required)::int as required_total,
        count(*) filter(where required and lower(status)='pass')::int as required_pass,
        count(*) filter(where required and lower(status)='pending')::int as required_pending,
        count(*) filter(where required and lower(status) not in ('pass','pending'))::int as required_failed
      from public.production_readiness_gates
    )
    select jsonb_build_object(
      'generated_at',now(),
      'organization_id',v_org,
      'summary',jsonb_build_object(
        'cron_total',(select count(*) from cron_classified),
        'cron_healthy',(select count(*) from cron_classified where health='healthy'),
        'cron_attention',(select count(*) from cron_classified where health<>'healthy'),
        'readiness_required',r.required_total,
        'readiness_pass',r.required_pass,
        'readiness_pending',r.required_pending,
        'readiness_failed',r.required_failed,
        'gateway_health_snapshots',(select count(*) from latest_gateway_health),
        'gateway_health_recent',(
          select count(*)
          from latest_gateway_health
          where checked_at>=now()-interval '15 minutes'
        )
      ),
      'queues',(select value from queue_metrics),
      'cron_jobs',coalesce((
        select jsonb_agg(jsonb_build_object(
          'job_id',c.jobid,
          'name',c.jobname,
          'schedule',c.schedule,
          'active',c.active,
          'last_status',c.run_status,
          'last_started_at',c.start_time,
          'last_finished_at',c.end_time,
          'expected_max_age_seconds',c.expected_max_age_seconds,
          'health',c.health
        ) order by
          case c.health when 'failed' then 0 when 'stale' then 1 when 'disabled' then 2 when 'unknown' then 3 else 4 end,
          c.jobname
        )
        from cron_classified c
      ),'[]'::jsonb),
      'readiness_gates',coalesce((
        select jsonb_agg(jsonb_build_object(
          'name',g.gate_name,
          'required',g.required,
          'status',g.status,
          'updated_at',g.updated_at
        ) order by
          case when g.required and lower(g.status)<>'pass' then 0 else 1 end,
          g.gate_name
        )
        from public.production_readiness_gates g
      ),'[]'::jsonb),
      'gateway_health',coalesce((
        select jsonb_agg(jsonb_build_object(
          'gateway_id',g.gateway_id,
          'gateway_name',g.gateway_name,
          'is_healthy',g.is_healthy,
          'latency_ms',g.latency_ms,
          'consecutive_failures',g.consecutive_failures,
          'circuit_state',g.circuit_state,
          'checked_at',g.checked_at,
          'fresh',g.checked_at>=now()-interval '15 minutes'
        ) order by g.is_healthy asc,g.checked_at desc)
        from latest_gateway_health g
      ),'[]'::jsonb),
      'recent_issues',jsonb_build_object(
        'event_dead_letters',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',d.id,
            'event_type',d.event_type,
            'reason',d.reason,
            'attempts',d.attempts,
            'last_failed_at',d.last_failed_at
          ) order by d.last_failed_at desc)
          from (
            select *
            from public.event_dead_letters
            where user_id in (select user_id from org_users)
              and resolved_at is null
            order by last_failed_at desc
            limit 25
          ) d
        ),'[]'::jsonb),
        'outbox_dead_letters',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',o.id,
            'channel',o.channel,
            'attempts',o.attempts,
            'last_error',o.last_error,
            'failed_at',o.failed_at,
            'created_at',o.created_at
          ) order by coalesce(o.failed_at,o.created_at) desc)
          from (
            select *
            from public.crm_channel_message_outbox
            where user_id in (select user_id from org_users)
              and status='dead_letter'
            order by coalesce(failed_at,created_at) desc
            limit 25
          ) o
        ),'[]'::jsonb),
        'drifts',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',d.id,
            'funnel_id',d.funnel_id,
            'expected_gateway_id',d.expected_gateway_id,
            'observed_gateway_id',d.observed_gateway_id,
            'observed_remote_gateway_ref',d.observed_remote_gateway_ref,
            'correlation_id',d.correlation_id,
            'detected_at',d.detected_at,
            'last_seen_at',d.last_seen_at
          ) order by d.last_seen_at desc)
          from (
            select *
            from public.funnel_control_drift_events
            where organization_id=v_org and status='open'
            order by last_seen_at desc
            limit 25
          ) d
        ),'[]'::jsonb)
      )
    )
    from readiness r
  );
end;
$function$;

revoke all on function public.platform_noc_status_v1() from public,anon;
grant execute on function public.platform_noc_status_v1() to authenticated;
