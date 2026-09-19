CREATE OR REPLACE FUNCTION public.gateway_control_center_v1(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_org uuid;
  v_limit integer:=greatest(1,least(coalesce(p_limit,20),50));
begin
  if v_uid is null then raise exception using errcode='42501',message='unauthorized'; end if;
  select default_organization_id into v_org from public.profiles where id=v_uid;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception using errcode='42501',message='organization_required';
  end if;

  return jsonb_build_object(
    'metrics',jsonb_build_object(
      'gateways',(
        select count(*) from public.gateways g
        where g.organization_id=v_org
      ),
      'operational_gateways',(
        select count(*) from public.gateways g
        where g.organization_id=v_org and lower(coalesce(g.status,'')) in ('connected','degraded')
      ),
      'funnels',(
        select count(*) from public.funnels f
        where f.organization_id=v_org and f.deleted_at is null
      ),
      'controllable_funnels',(
        select count(distinct c.funnel_id) from public.funnel_connections c
        where c.organization_id=v_org
          and c.status='active'
          and c.write_enabled=true
          and c.control_status in ('ready','degraded')
          and c.capabilities ? 'gateway:read'
          and c.capabilities ? 'gateway:write'
      ),
      'active_drifts',(
        select count(*) from public.funnel_control_drift_events d
        where d.organization_id=v_org and d.status='open'
      ),
      'running_batches',(
        select count(*) from public.funnel_command_batches b
        where b.organization_id=v_org and b.status in ('queued','running')
      )
    ),
    'gateways',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',g.id,
        'name',coalesce(g.display_name,g.provider,g.id),
        'provider',g.provider,
        'environment',g.environment,
        'status',g.status,
        'mapped_funnels',coalesce((
          select count(distinct m.funnel_id)
          from public.funnel_connection_gateway_mappings m
          where m.organization_id=v_org
            and m.gateway_id=g.id
            and m.status='active'
        ),0),
        'primary_funnels',coalesce((
          select count(distinct b.funnel_id)
          from public.funnel_gateway_bindings b
          where b.organization_id=v_org
            and b.gateway_id=g.id
            and b.status='active'
            and b.is_primary=true
        ),0)
      ) order by
        case when lower(coalesce(g.status,'')) in ('connected','degraded') then 0 else 1 end,
        coalesce(g.display_name,g.provider,g.id)
      )
      from public.gateways g
      where g.organization_id=v_org
    ),'[]'::jsonb),
    'connections',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,
        'funnel_id',c.funnel_id,
        'funnel_name',f.nome,
        'status',c.status,
        'health_status',c.health_status,
        'control_status',c.control_status,
        'write_enabled',c.write_enabled,
        'capabilities',c.capabilities,
        'desired_gateway_id',c.desired_gateway_id,
        'desired_gateway_name',coalesce(gd.display_name,gd.provider,c.desired_gateway_id),
        'observed_gateway_id',c.observed_gateway_id,
        'observed_gateway_name',coalesce(go.display_name,go.provider,c.observed_gateway_id),
        'last_verified_at',c.last_verified_at,
        'last_command_at',c.last_command_at,
        'last_error',c.last_error,
        'mappings',coalesce((
          select jsonb_agg(jsonb_build_object(
            'gateway_id',m.gateway_id,
            'gateway_name',coalesce(gm.display_name,gm.provider,m.gateway_id),
            'remote_gateway_ref',m.remote_gateway_ref,
            'status',m.status
          ) order by coalesce(gm.display_name,gm.provider,m.gateway_id))
          from public.funnel_connection_gateway_mappings m
          left join public.gateways gm
            on gm.id=m.gateway_id and gm.organization_id=m.organization_id
          where m.organization_id=v_org and m.connection_id=c.id
        ),'[]'::jsonb)
      ) order by f.nome nulls last,c.created_at)
      from public.funnel_connections c
      left join public.funnels f
        on f.id=c.funnel_id and f.organization_id=c.organization_id
      left join public.gateways gd
        on gd.id=c.desired_gateway_id and gd.organization_id=c.organization_id
      left join public.gateways go
        on go.id=c.observed_gateway_id and go.organization_id=c.organization_id
      where c.organization_id=v_org
    ),'[]'::jsonb),
    'batches',coalesce((
      select jsonb_agg(bj.item order by bj.requested_at desc)
      from (
        select
          b.requested_at,
          jsonb_build_object(
            'id',b.id,
            'correlation_id',b.correlation_id,
            'command_type',b.command_type,
            'target_gateway_id',b.target_gateway_id,
            'target_gateway_name',coalesce(g.display_name,g.provider,b.target_gateway_id),
            'dry_run',b.dry_run,
            'allow_partial',b.allow_partial,
            'status',b.status,
            'phase',coalesce(b.metadata->>'phase','preflight'),
            'total_targets',b.total_targets,
            'succeeded_targets',b.succeeded_targets,
            'failed_targets',b.failed_targets,
            'pending_targets',b.pending_targets,
            'requested_at',b.requested_at,
            'started_at',b.started_at,
            'completed_at',b.completed_at,
            'rollback_of',b.metadata->>'rollback_of',
            'targets',coalesce((
              select jsonb_agg(jsonb_build_object(
                'id',t.id,
                'funnel_id',t.funnel_id,
                'funnel_name',f.nome,
                'status',t.status,
                'attempt_count',t.attempt_count,
                'max_attempts',t.max_attempts,
                'target_gateway_id',t.target_gateway_id,
                'target_gateway_name',coalesce(tg.display_name,tg.provider,t.target_gateway_id),
                'previous_gateway_id',t.previous_gateway_id,
                'previous_gateway_name',coalesce(pg.display_name,pg.provider,t.previous_gateway_id),
                'target_remote_gateway_ref',t.target_remote_gateway_ref,
                'previous_remote_gateway_ref',t.previous_remote_gateway_ref,
                'last_error_code',t.last_error_code,
                'last_error_message',t.last_error_message,
                'started_at',t.started_at,
                'verified_at',t.verified_at,
                'completed_at',t.completed_at,
                'updated_at',t.updated_at
              ) order by f.nome nulls last,t.created_at)
              from public.funnel_command_targets t
              left join public.funnels f
                on f.id=t.funnel_id and f.organization_id=t.organization_id
              left join public.gateways tg
                on tg.id=t.target_gateway_id and tg.organization_id=t.organization_id
              left join public.gateways pg
                on pg.id=t.previous_gateway_id and pg.organization_id=t.organization_id
              where t.batch_id=b.id and t.organization_id=v_org
            ),'[]'::jsonb)
          ) as item
        from public.funnel_command_batches b
        left join public.gateways g
          on g.id=b.target_gateway_id and g.organization_id=b.organization_id
        where b.organization_id=v_org
        order by b.requested_at desc
        limit v_limit
      ) bj
    ),'[]'::jsonb),
    'drifts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,
        'connection_id',d.connection_id,
        'funnel_id',d.funnel_id,
        'funnel_name',f.nome,
        'expected_gateway_id',d.expected_gateway_id,
        'expected_gateway_name',coalesce(ge.display_name,ge.provider,d.expected_gateway_id),
        'observed_gateway_id',d.observed_gateway_id,
        'observed_gateway_name',coalesce(go.display_name,go.provider,d.observed_gateway_id),
        'observed_remote_gateway_ref',d.observed_remote_gateway_ref,
        'status',d.status,
        'correlation_id',d.correlation_id,
        'details',d.details,
        'detected_at',d.detected_at,
        'last_seen_at',d.last_seen_at,
        'resolved_at',d.resolved_at
      ) order by d.detected_at desc)
      from (
        select *
        from public.funnel_control_drift_events
        where organization_id=v_org
        order by detected_at desc
        limit 100
      ) d
      left join public.funnels f on f.id=d.funnel_id and f.organization_id=d.organization_id
      left join public.gateways ge on ge.id=d.expected_gateway_id and ge.organization_id=d.organization_id
      left join public.gateways go on go.id=d.observed_gateway_id and go.organization_id=d.organization_id
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.gateway_control_center_v1(integer) from public,anon;
grant execute on function public.gateway_control_center_v1(integer) to authenticated;