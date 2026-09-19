CREATE OR REPLACE FUNCTION public.command_center_operations_v1(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_hours integer:=greatest(1,least(coalesce(p_hours,24),168));
  v_start timestamptz:=now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),168)));
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;

  select default_organization_id into v_org
  from public.profiles
  where id=v_uid;

  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  return (
    with metrics as (
      select
        (select count(*)::bigint
           from public.attribution_sessions s
          where s.organization_id=v_org
            and s.session_state='active'
            and s.last_seen_at>=now()-interval '15 minutes') as live_sessions,

        (select count(*)::bigint
           from public.attribution_sessions s
          where s.organization_id=v_org
            and s.session_state='active'
            and s.last_seen_at>=now()-interval '15 minutes'
            and s.customer_id is not null) as identified_live_sessions,

        (select count(*)::bigint
           from public.gateway_transactions t
          where t.organization_id=v_org and t.created_at>=v_start) as payment_transactions,

        (select count(*)::bigint
           from public.gateway_transactions t
          where t.organization_id=v_org and t.created_at>=v_start and lower(t.status)='approved') as approved_payments,

        (select count(*)::bigint
           from public.gateway_transactions t
          where t.organization_id=v_org and t.created_at>=v_start and lower(t.status) in ('created','pending','processing')) as pending_payments,

        (select count(*)::bigint
           from public.gateway_transactions t
          where t.organization_id=v_org and t.created_at>=v_start and lower(t.status)='failed') as failed_payments,

        (select coalesce(sum(t.amount),0)::numeric
           from public.gateway_transactions t
          where t.organization_id=v_org and t.created_at>=v_start and lower(t.status)='approved') as approved_volume,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start) as checkout_count,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start
            and (lower(c.status)='completed' or c.completed_at is not null)) as completed_checkouts,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start and lower(c.status)='abandoned') as abandoned_checkouts,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start
            and c.recovery_status in ('queued','processing','queued_delivery','processing_delivery','outbox_queued')) as recovery_in_progress,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start
            and c.recovery_status in ('blocked_consent','blocked_no_channel','blocked_no_destination')) as recovery_blocked,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start
            and c.recovery_status in ('delivery_failed','dead_letter')) as recovery_failed,

        (select count(*)::bigint
           from public.checkout_sessions c
          where c.organization_id=v_org and c.created_at>=v_start
            and c.recovery_status='recovered') as recovered_checkouts,

        (select count(*)::bigint
           from public.crm_conversations c
          where c.user_id=v_uid and c.status in ('open','pending')) as crm_open,

        (select coalesce(sum(c.unread_count),0)::bigint
           from public.crm_conversations c
          where c.user_id=v_uid and c.status in ('open','pending') and c.unread_count>0) as crm_unread,

        (select count(*)::bigint
           from public.crm_conversations c
          where c.user_id=v_uid
            and c.status in ('open','pending')
            and c.first_response_at is null
            and c.first_response_due_at is not null
            and c.first_response_due_at<now()) as crm_sla_overdue,

        (select count(*)::bigint
           from public.funnels f
          where f.organization_id=v_org and f.deleted_at is null) as funnels,

        (select count(*)::bigint
           from public.funnel_connections c
          where c.organization_id=v_org and c.status='active') as active_connections,

        (select count(distinct c.funnel_id)::bigint
           from public.funnel_connections c
          where c.organization_id=v_org
            and c.status='active'
            and c.write_enabled=true
            and c.control_status in ('ready','degraded')
            and c.capabilities ? 'gateway:read'
            and c.capabilities ? 'gateway:write') as controllable_funnels,

        (select count(*)::bigint
           from public.funnel_connections c
          where c.organization_id=v_org
            and c.status='active'
            and (c.control_status='error' or lower(coalesce(c.health_status,''))='unhealthy')) as connection_errors,

        (select count(*)::bigint
           from public.gateways g
          where g.organization_id=v_org) as gateways,

        (select count(*)::bigint
           from public.gateways g
          where g.organization_id=v_org and lower(g.status) in ('connected','degraded')) as operational_gateways,

        (select count(*)::bigint
           from public.funnel_control_drift_events d
          where d.organization_id=v_org and d.status='open') as open_drifts,

        (select count(*)::bigint
           from public.funnel_command_batches b
          where b.organization_id=v_org and b.status in ('queued','running')) as active_command_batches,

        (select count(*)::bigint
           from public.funnel_command_targets t
          where t.organization_id=v_org
            and t.updated_at>=v_start
            and t.status in ('failed','blocked')) as failed_command_targets,

        (select count(*)::bigint
           from public.integration_events e
          where e.organization_id=v_org and e.created_at>=v_start) as integration_events,

        (select count(*)::bigint
           from public.integration_events e
          where e.organization_id=v_org and e.created_at>=v_start
            and e.status in ('failed','retry')) as integration_errors
    ),
    normalized as (
      select m.*,
        case when m.payment_transactions>0
          then round(m.approved_payments::numeric*100/m.payment_transactions,2)
          else 0 end as payment_approval_rate,
        case
          when m.connection_errors>0 or m.failed_command_targets>0 then 'critical'
          when m.open_drifts>0 or m.recovery_failed>0 or m.crm_sla_overdue>0 or m.integration_errors>0 then 'attention'
          else 'operational'
        end as operation_status
      from metrics m
    ),
    attention as (
      select * from (
        select 1 as severity_rank,'critical'::text as severity,'command_failures'::text as code,
          'Command Engine com falhas'::text as title,
          format('%s target(s) de comando falharam ou foram bloqueados nas últimas %s horas.',n.failed_command_targets,v_hours) as message,
          n.failed_command_targets as count,
          '/dashboard/routing'::text as href
        from normalized n where n.failed_command_targets>0

        union all
        select 1,'critical','connection_errors',
          'Conexões de funil com erro',
          format('%s conexão(ões) remota(s) estão em estado de erro ou unhealthy.',n.connection_errors),
          n.connection_errors,'/dashboard/routing'
        from normalized n where n.connection_errors>0

        union all
        select 2,'warning','gateway_drift',
          'Drift de gateway detectado',
          format('%s funil(is) divergem do estado de gateway esperado.',n.open_drifts),
          n.open_drifts,'/dashboard/routing'
        from normalized n where n.open_drifts>0

        union all
        select 2,'warning','recovery_delivery',
          'Recovery com falha de entrega',
          format('%s checkout(s) estão em delivery_failed ou dead_letter.',n.recovery_failed),
          n.recovery_failed,'/dashboard/recovery'
        from normalized n where n.recovery_failed>0

        union all
        select 2,'warning','recovery_blocked',
          'Recovery bloqueado',
          format('%s checkout(s) aguardam consentimento, canal ativo ou destino válido.',n.recovery_blocked),
          n.recovery_blocked,'/dashboard/recovery'
        from normalized n where n.recovery_blocked>0

        union all
        select 2,'warning','crm_sla',
          'SLA do CRM vencido',
          format('%s conversa(s) abertas ainda não receberam a primeira resposta no prazo.',n.crm_sla_overdue),
          n.crm_sla_overdue,'/dashboard/crm'
        from normalized n where n.crm_sla_overdue>0

        union all
        select 2,'warning','integration_errors',
          'Eventos de integração com erro',
          format('%s evento(s) estão em failed/retry nas últimas %s horas.',n.integration_errors,v_hours),
          n.integration_errors,'/dashboard/funil'
        from normalized n where n.integration_errors>0

        union all
        select 3,'info','gateway_availability',
          'Gateways indisponíveis',
          format('%s de %s gateway(s) não estão operacionais.',n.gateways-n.operational_gateways,n.gateways),
          n.gateways-n.operational_gateways,'/dashboard/gateways'
        from normalized n where n.gateways>n.operational_gateways
      ) a
    )
    select jsonb_build_object(
      'window',jsonb_build_object('hours',v_hours,'start_at',v_start,'end_at',now()),
      'status',(select operation_status from normalized),
      'metrics',(
        select to_jsonb(n)-'operation_status'
        from normalized n
      ),
      'attention',coalesce((
        select jsonb_agg(jsonb_build_object(
          'severity',a.severity,
          'code',a.code,
          'title',a.title,
          'message',a.message,
          'count',a.count,
          'href',a.href
        ) order by a.severity_rank,a.count desc,a.code)
        from attention a
      ),'[]'::jsonb),
      'recent_commands',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',b.id,
          'correlation_id',b.correlation_id,
          'command_type',b.command_type,
          'status',b.status,
          'target_gateway_id',b.target_gateway_id,
          'target_gateway_name',coalesce(g.display_name,g.provider,b.target_gateway_id),
          'dry_run',b.dry_run,
          'total_targets',b.total_targets,
          'succeeded_targets',b.succeeded_targets,
          'failed_targets',b.failed_targets,
          'pending_targets',b.pending_targets,
          'requested_at',b.requested_at,
          'completed_at',b.completed_at
        ) order by b.requested_at desc)
        from (
          select *
          from public.funnel_command_batches
          where organization_id=v_org
          order by requested_at desc
          limit 5
        ) b
        left join public.gateways g on g.id=b.target_gateway_id and g.organization_id=b.organization_id
      ),'[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.command_center_operations_v1(integer) from public,anon;
grant execute on function public.command_center_operations_v1(integer) to authenticated;
