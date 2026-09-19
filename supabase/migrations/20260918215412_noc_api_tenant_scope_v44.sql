CREATE OR REPLACE FUNCTION public.noc_operations_v1(p_minutes integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'cron', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_minutes integer:=greatest(15,least(coalesce(p_minutes,60),360));
  v_start timestamptz:=now()-make_interval(mins=>greatest(15,least(coalesce(p_minutes,60),360)));
begin
  if v_uid is null then
    raise exception using errcode='42501',message='unauthorized';
  end if;

  select default_organization_id into v_org
  from public.profiles
  where id=v_uid;

  if v_org is null
     or not private.has_org_role(v_org,array['owner','admin','manager','operator','supervisor']) then
    raise exception using errcode='42501',message='operator_role_required';
  end if;

  return (
    with recent_cron as (
      select r.runid,r.jobid,r.status,r.start_time,r.end_time
      from cron.job_run_details r
      order by r.runid desc
      limit 5000
    ),
    cron_last as (
      select distinct on (r.jobid)
        r.jobid,r.status,r.start_time,r.end_time,r.runid
      from recent_cron r
      order by r.jobid,r.runid desc
    ),
    metrics as (
      select
        (select count(*)::bigint from cron.job j where j.active=true) as cron_active_jobs,
        (select count(*)::bigint
           from recent_cron r
          where r.start_time>=v_start
            and r.status not in ('succeeded','running')) as cron_failures,

        (select count(*)::bigint
           from public.api_request_logs a
          where exists(
            select 1 from public.organization_members om
            where om.organization_id=v_org and om.user_id=a.user_id
          )
            and a.created_at>=v_start) as api_requests,
        (select count(*)::bigint
           from public.api_request_logs a
          where exists(
            select 1 from public.organization_members om
            where om.organization_id=v_org and om.user_id=a.user_id
          )
            and a.created_at>=v_start
            and coalesce(a.status_code,0)>=500) as api_5xx,
        (select coalesce(round(percentile_cont(0.95) within group(order by a.latency_ms))::numeric,0)
           from public.api_request_logs a
          where exists(
            select 1 from public.organization_members om
            where om.organization_id=v_org and om.user_id=a.user_id
          )
            and a.created_at>=v_start and a.latency_ms is not null) as api_p95_ms,

        (select count(*)::bigint
           from public.integration_events e
          where e.organization_id=v_org and e.created_at>=v_start
            and e.status in ('failed','retry')) as integration_failures,

        (select count(*)::bigint
           from public.gateway_webhook_events w
          where w.organization_id=v_org and w.received_at>=v_start
            and w.status in ('failed','retry','error')) as gateway_webhook_failures,

        (select count(*)::bigint
           from public.gateway_operation_logs g
          where g.user_id=v_uid and g.created_at>=v_start
            and lower(g.status) in ('failed','error','timeout','rejected')) as gateway_operation_failures,

        (select coalesce(round(avg(g.duration_ms))::numeric,0)
           from public.gateway_operation_logs g
          where g.user_id=v_uid and g.created_at>=v_start and g.duration_ms is not null) as gateway_avg_latency_ms,

        (select count(*)::bigint
           from public.automation_executions a
          where a.organization_id=v_org and a.created_at>=v_start
            and (a.status in ('failed','dead_letter') or a.dead_lettered_at is not null)) as automation_failures,

        (select count(*)::bigint
           from public.crm_channel_message_outbox o
          where o.user_id=v_uid and o.created_at>=v_start
            and o.status in ('failed','dead_letter')) as crm_outbox_failures,

        (select count(*)::bigint
           from public.webhook_deliveries w
          where w.user_id=v_uid and w.created_at>=v_start
            and w.status in ('failed','retry','error')) as outbound_webhook_failures,

        (select count(*)::bigint
           from public.reconciliation_items r
          where r.organization_id=v_org and r.created_at>=v_start
            and lower(r.status) in ('mismatch','amount_mismatch','missing_local','missing_gateway','failed','error')) as reconciliation_exceptions,

        (select count(*)::bigint
           from public.recovery_events r
          where r.organization_id=v_org and r.created_at>=v_start
            and r.status in ('delivery_failed','dead_letter')) as recovery_failures,

        (select count(*)::bigint
           from public.funnel_command_targets t
          where t.organization_id=v_org and t.updated_at>=v_start
            and t.status in ('failed','blocked')) as command_failures,

        (select count(*)::bigint
           from public.production_readiness_gates g
          where g.required=true and g.status='pass') as readiness_passed,
        (select count(*)::bigint
           from public.production_readiness_gates g
          where g.required=true) as readiness_required,
        (select count(*)::bigint
           from public.production_readiness_gates g
          where g.required=true and g.status not in ('pass','pending')) as readiness_failed,

        (select count(*)::bigint
           from public.platform_health_checks h
          where lower(h.status) in ('failed','error','critical','unhealthy')) as platform_health_failures
    ),
    queues as (
      select jsonb_build_array(
        jsonb_build_object(
          'key','integration_events','label','Integration events',
          'count',(select count(*) from public.integration_events e where e.organization_id=v_org and e.status in ('pending','retry','processing')),
          'href','/dashboard/funil'
        ),
        jsonb_build_object(
          'key','automation','label','Automações',
          'count',(select count(*) from public.automation_executions a where a.organization_id=v_org and (a.status in ('failed','retry_scheduled','scheduled','running') or (a.next_retry_at is not null and a.completed_at is null))),
          'href','/dashboard/automations'
        ),
        jsonb_build_object(
          'key','crm_outbox','label','CRM outbox',
          'count',(select count(*) from public.crm_channel_message_outbox o where o.user_id=v_uid and o.status in ('queued','processing','failed')),
          'href','/dashboard/crm'
        ),
        jsonb_build_object(
          'key','gateway_webhooks','label','Gateway webhooks',
          'count',(select count(*) from public.gateway_webhook_events w where w.organization_id=v_org and w.status in ('pending','retry','processing','failed')),
          'href','/dashboard/pagamentos'
        ),
        jsonb_build_object(
          'key','recovery','label','Recovery',
          'count',(select count(*) from public.recovery_events r where r.organization_id=v_org and r.status in ('queued','processing','outbox_queued','delivery_failed','dead_letter')),
          'href','/dashboard/recovery'
        ),
        jsonb_build_object(
          'key','commands','label','Funnel commands',
          'count',(select count(*) from public.funnel_command_targets t where t.organization_id=v_org and t.status in ('queued','claimed','preflight_ready','applying','verifying','failed','blocked')),
          'href','/dashboard/routing'
        )
      ) as value
    ),
    normalized as (
      select m.*,
        case
          when m.cron_failures>0
            or m.platform_health_failures>0
            or m.command_failures>0
            or m.reconciliation_exceptions>0 then 'critical'
          when m.api_5xx>0
            or m.integration_failures>0
            or m.gateway_webhook_failures>0
            or m.gateway_operation_failures>0
            or m.automation_failures>0
            or m.crm_outbox_failures>0
            or m.outbound_webhook_failures>0
            or m.recovery_failures>0 then 'attention'
          else 'operational'
        end as noc_status
      from metrics m
    ),
    incidents as (
      select * from (
        select 1 severity_rank,'critical'::text severity,'cron'::text source,
          'cron_failure'::text code,'Scheduler com falha'::text title,
          r.status::text status,r.start_time as occurred_at,'/dashboard/noc'::text href
        from recent_cron r
        where r.start_time>=v_start and r.status not in ('succeeded','running')

        union all
        select 1,'critical','command_engine','command_target_failure',
          'Command target falhou ou foi bloqueado',t.status,t.updated_at,'/dashboard/routing'
        from public.funnel_command_targets t
        where t.organization_id=v_org and t.updated_at>=v_start and t.status in ('failed','blocked')

        union all
        select 1,'critical','reconciliation','reconciliation_exception',
          'Exceção de conciliação',r.status,r.updated_at,'/dashboard/pagamentos'
        from public.reconciliation_items r
        where r.organization_id=v_org and r.created_at>=v_start
          and lower(r.status) in ('mismatch','amount_mismatch','missing_local','missing_gateway','failed','error')

        union all
        select 2,'warning','integration','integration_failure',
          'Evento de integração requer retry',e.status,e.created_at,'/dashboard/funil'
        from public.integration_events e
        where e.organization_id=v_org and e.created_at>=v_start and e.status in ('failed','retry')

        union all
        select 2,'warning','gateway_webhook','gateway_webhook_failure',
          'Webhook de gateway requer atenção',w.status,w.received_at,'/dashboard/pagamentos'
        from public.gateway_webhook_events w
        where w.organization_id=v_org and w.received_at>=v_start and w.status in ('failed','retry','error')

        union all
        select 2,'warning','automation','automation_failure',
          'Automação falhou',a.status,a.created_at,'/dashboard/automations'
        from public.automation_executions a
        where a.organization_id=v_org and a.created_at>=v_start
          and (a.status in ('failed','dead_letter') or a.dead_lettered_at is not null)

        union all
        select 2,'warning','crm_outbox','crm_delivery_failure',
          'Mensagem CRM falhou',o.status,o.updated_at,'/dashboard/crm'
        from public.crm_channel_message_outbox o
        where o.user_id=v_uid and o.created_at>=v_start and o.status in ('failed','dead_letter')

        union all
        select 2,'warning','recovery','recovery_failure',
          'Recovery terminou com falha',r.status,r.updated_at,'/dashboard/recovery'
        from public.recovery_events r
        where r.organization_id=v_org and r.created_at>=v_start and r.status in ('delivery_failed','dead_letter')

        union all
        select 2,'warning','api','api_5xx',
          'API respondeu com erro 5xx',coalesce(a.status_code::text,'5xx'),a.created_at,'/dashboard/api'
        from public.api_request_logs a
        where exists(
          select 1 from public.organization_members om
          where om.organization_id=v_org and om.user_id=a.user_id
        )
          and a.created_at>=v_start and coalesce(a.status_code,0)>=500
      ) x
    )
    select jsonb_build_object(
      'window',jsonb_build_object('minutes',v_minutes,'start_at',v_start,'end_at',now(),'cron_sample_limit',5000),
      'status',(select noc_status from normalized),
      'metrics',(select to_jsonb(n)-'noc_status' from normalized n),
      'queues',(select value from queues),
      'cron_jobs',coalesce((
        select jsonb_agg(jsonb_build_object(
          'jobid',j.jobid,
          'jobname',j.jobname,
          'schedule',j.schedule,
          'active',j.active,
          'last_status',r.status,
          'last_start_at',r.start_time,
          'last_end_at',r.end_time,
          'last_duration_ms',case when r.start_time is not null and r.end_time is not null
            then floor(extract(epoch from (r.end_time-r.start_time))*1000)::bigint else null end
        ) order by j.jobname)
        from cron.job j
        left join cron_last r on r.jobid=j.jobid
        where j.active=true
      ),'[]'::jsonb),
      'health_checks',coalesce((
        select jsonb_agg(jsonb_build_object(
          'check_name',h.check_name,
          'status',h.status,
          'checked_at',h.checked_at
        ) order by h.check_name)
        from public.platform_health_checks h
      ),'[]'::jsonb),
      'readiness',coalesce((
        select jsonb_agg(jsonb_build_object(
          'gate_name',g.gate_name,
          'required',g.required,
          'status',g.status,
          'updated_at',g.updated_at
        ) order by g.required desc,g.gate_name)
        from public.production_readiness_gates g
      ),'[]'::jsonb),
      'incidents',coalesce((
        select jsonb_agg(jsonb_build_object(
          'severity',i.severity,
          'source',i.source,
          'code',i.code,
          'title',i.title,
          'status',i.status,
          'occurred_at',i.occurred_at,
          'href',i.href
        ) order by i.severity_rank,i.occurred_at desc)
        from (
          select * from incidents
          order by severity_rank,occurred_at desc
          limit 50
        ) i
      ),'[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.noc_operations_v1(integer) from public,anon;
grant execute on function public.noc_operations_v1(integer) to authenticated;
