-- Release prerequisite: canonical integration-event lifecycle transitions.
-- This migration intentionally DOES NOT revoke the existing service_role UPDATE privilege
-- on public.integration_events. That privilege is transitional and must be tightened only
-- after Gate A proves all live callers use the RPC lifecycle contract.

create or replace function public.claim_integration_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_claimed timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select status, claimed_at
    into v_status, v_claimed
    from public.integration_events
   where id=p_event_id
   for update;

  if not found then
    return false;
  end if;

  if v_status='processing'
     and (v_claimed is null or v_claimed > now()-interval '10 minutes') then
    return false;
  end if;

  if v_status not in ('pending','retry','received','processing') then
    return false;
  end if;

  update public.integration_events
     set status='processing',
         claimed_at=now(),
         claim_attempt=coalesce(claim_attempt,0)+1,
         error_message=null,
         processed_at=null
   where id=p_event_id;

  return true;
end
$function$;

revoke all on function public.claim_integration_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_integration_event(uuid) to service_role;

create or replace function public.mark_integration_event_processed(
  p_event_id uuid,
  p_status text default 'processed',
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_current_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_status not in ('processed','retry') then
    raise exception 'integration_event_status_not_allowed' using errcode='22023';
  end if;

  select status
    into v_current_status
    from public.integration_events
   where id=p_event_id
   for update;

  if not found then
    return;
  end if;

  if v_current_status <> 'processing' then
    raise exception 'integration_event_invalid_transition:%->%', v_current_status, p_status
      using errcode='55000';
  end if;

  update public.integration_events
     set status=p_status,
         processed_at=case when p_status='processed' then now() else null end,
         error_message=case when p_status='processed' then null else left(p_error,2000) end,
         claimed_at=null,
         next_retry_at=null
   where id=p_event_id;
end
$function$;

revoke all on function public.mark_integration_event_processed(uuid,text,text) from public, anon, authenticated;
grant execute on function public.mark_integration_event_processed(uuid,text,text) to service_role;

create or replace function public.schedule_integration_event_retry(
  p_event_id uuid,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt integer;
  v_status text;
  v_delay integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select claim_attempt, status
    into v_attempt, v_status
    from public.integration_events
   where id=p_event_id
   for update;

  if not found then
    return false;
  end if;

  if v_status not in ('pending','received','processing','retry','failed') then
    raise exception 'integration_event_invalid_retry_transition:%', v_status
      using errcode='55000';
  end if;

  v_attempt:=coalesce(v_attempt,0);

  if v_attempt>=8 then
    update public.integration_events
       set status='failed',
           error_message=left(coalesce(p_error,error_message),2000),
           processed_at=now(),
           claimed_at=null,
           next_retry_at=null
     where id=p_event_id;
    return false;
  end if;

  v_delay:=least(3600,greatest(60,power(2,greatest(v_attempt-1,0))::integer*60));

  update public.integration_events
     set status='retry',
         error_message=left(p_error,2000),
         next_retry_at=now()+make_interval(secs=>v_delay),
         processed_at=null,
         claimed_at=null
   where id=p_event_id;

  return true;
end
$function$;

revoke all on function public.schedule_integration_event_retry(uuid,text) from public, anon, authenticated;
grant execute on function public.schedule_integration_event_retry(uuid,text) to service_role;

create or replace function public.server_retry_integration_event_v1(
  p_event_id uuid,
  p_error text,
  p_delay_seconds integer default null,
  p_increment_retry_count boolean default false
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_retry_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_delay_seconds is not null and (p_delay_seconds < 0 or p_delay_seconds > 86400) then
    raise exception 'invalid_retry_delay' using errcode='22023';
  end if;

  select status, coalesce(retry_count,0)
    into v_status, v_retry_count
    from public.integration_events
   where id=p_event_id
   for update;

  if not found then
    return null;
  end if;

  if v_status not in ('pending','received','processing','retry','failed') then
    raise exception 'integration_event_invalid_retry_transition:%', v_status
      using errcode='55000';
  end if;

  if coalesce(p_increment_retry_count,false) then
    v_retry_count:=v_retry_count+1;
  end if;

  update public.integration_events
     set status='retry',
         retry_count=v_retry_count,
         error_message=left(p_error,2000),
         next_retry_at=case
           when p_delay_seconds is null then null
           else now()+make_interval(secs=>p_delay_seconds)
         end,
         processed_at=null,
         claimed_at=null
   where id=p_event_id;

  return v_retry_count;
end
$function$;

revoke all on function public.server_retry_integration_event_v1(uuid,text,integer,boolean)
  from public, anon, authenticated;
grant execute on function public.server_retry_integration_event_v1(uuid,text,integer,boolean)
  to service_role;

create or replace function public.server_claim_integration_event_worker_v1(
  p_event_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_retry_count integer;
  v_next_retry_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select status, coalesce(retry_count,0), next_retry_at
    into v_status, v_retry_count, v_next_retry_at
    from public.integration_events
   where id=p_event_id
   for update;

  if not found then
    return null;
  end if;

  if v_status not in ('pending','failed','retry','received') then
    return null;
  end if;

  if v_next_retry_at is not null and v_next_retry_at > now() then
    return null;
  end if;

  v_retry_count:=v_retry_count+1;

  update public.integration_events
     set status='processing',
         retry_count=v_retry_count,
         claimed_at=now(),
         claim_attempt=coalesce(claim_attempt,0)+1,
         error_message=null,
         processed_at=null
   where id=p_event_id;

  return v_retry_count;
end
$function$;

revoke all on function public.server_claim_integration_event_worker_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.server_claim_integration_event_worker_v1(uuid)
  to service_role;

create or replace function public.server_record_integration_event_failure_v1(
  p_event_id uuid,
  p_error text,
  p_max_retries integer default 5,
  p_max_delay_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_retry_count integer;
  v_next_retry_at timestamptz;
  v_delay integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if p_max_retries < 1 or p_max_retries > 100
     or p_max_delay_seconds < 1 or p_max_delay_seconds > 86400 then
    raise exception 'invalid_failure_policy' using errcode='22023';
  end if;

  select status, coalesce(retry_count,0)
    into v_status, v_retry_count
    from public.integration_events
   where id=p_event_id
   for update;

  if not found then
    return jsonb_build_object('updated',false,'reason','event_not_found');
  end if;

  if v_status <> 'processing' then
    raise exception 'integration_event_invalid_failure_transition:%', v_status
      using errcode='55000';
  end if;

  if v_retry_count >= p_max_retries then
    v_status:='dead_letter';
    v_next_retry_at:=null;
  else
    v_status:='failed';
    v_delay:=least(p_max_delay_seconds,greatest(1,power(2,v_retry_count)::integer));
    v_next_retry_at:=now()+make_interval(secs=>v_delay);
  end if;

  update public.integration_events
     set status=v_status,
         error_message=left(p_error,2000),
         next_retry_at=v_next_retry_at,
         claimed_at=null,
         processed_at=null
   where id=p_event_id;

  return jsonb_build_object(
    'updated',true,
    'status',v_status,
    'retry_count',v_retry_count,
    'next_retry_at',v_next_retry_at
  );
end
$function$;

revoke all on function public.server_record_integration_event_failure_v1(uuid,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.server_record_integration_event_failure_v1(uuid,text,integer,integer)
  to service_role;

do $post_guard$
begin
  if not has_function_privilege('service_role','public.claim_integration_event(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.mark_integration_event_processed(uuid,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.schedule_integration_event_retry(uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.server_retry_integration_event_v1(uuid,text,integer,boolean)','EXECUTE')
     or not has_function_privilege('service_role','public.server_claim_integration_event_worker_v1(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.server_record_integration_event_failure_v1(uuid,text,integer,integer)','EXECUTE') then
    raise exception 'integration_event_lifecycle_post_guard: service_role lifecycle execute grant missing';
  end if;

  if has_function_privilege('anon','public.server_retry_integration_event_v1(uuid,text,integer,boolean)','EXECUTE')
     or has_function_privilege('authenticated','public.server_retry_integration_event_v1(uuid,text,integer,boolean)','EXECUTE')
     or has_function_privilege('anon','public.server_claim_integration_event_worker_v1(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.server_claim_integration_event_worker_v1(uuid)','EXECUTE')
     or has_function_privilege('anon','public.server_record_integration_event_failure_v1(uuid,text,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.server_record_integration_event_failure_v1(uuid,text,integer,integer)','EXECUTE') then
    raise exception 'integration_event_lifecycle_post_guard: privileged lifecycle RPC exposed to client role';
  end if;
end
$post_guard$;

-- Follow-up release contract (NOT executed here):
-- After #111-A is live and Gate A proves no runtime caller performs direct UPDATE on
-- public.integration_events, create a separate privilege-tightening migration:
--   revoke update on table public.integration_events from service_role;
-- Do not fold that revocation into this migration.
