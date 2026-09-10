CREATE OR REPLACE FUNCTION public.crm_replay_automation_execution(p_execution_id uuid, p_reason text DEFAULT NULL::text)
RETURNS public.automation_executions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r public.automation_executions;
  v_key text;
  v_existing public.idempotency_keys;
  v_idem_id uuid;
begin
  select * into r from public.automation_executions where id=p_execution_id and user_id=auth.uid() for update;
  if not found then raise exception 'automation_execution_not_found'; end if;

  v_key := 'automation-replay:' || r.id::text || ':' || extract(epoch from coalesce(r.dead_lettered_at, r.created_at))::text;
  select * into v_existing from public.idempotency_keys where user_id=auth.uid() and scope='automation_replay' and idempotency_key=v_key for update;
  if found then return r; end if;
  if r.status <> 'dead_letter' then raise exception 'automation_execution_not_dead_letter'; end if;

  insert into public.idempotency_keys(user_id,scope,idempotency_key,status,resource_type,resource_id,response_payload,request_digest)
  values(auth.uid(),'automation_replay',v_key,'processing','automation_execution',r.id::text,jsonb_build_object('execution_id',r.id,'reason',p_reason),encode(digest(v_key,'sha256'),'hex'))
  returning id into v_idem_id;

  update public.automation_executions
  set status='scheduled', dead_lettered_at=null, error_message=null, next_retry_at=null,
      scheduled_at=now(), replayed_at=now(), replay_count=coalesce(replay_count,0)+1,
      cancellation_reason=left(coalesce(p_reason,'manual replay'),1000)
  where id=r.id returning * into r;

  insert into public.audit_logs(user_id,actor_id,action,resource_type,resource_id,metadata)
  values(auth.uid(),auth.uid(),'automation.replay','automation_execution',r.id::text,
         jsonb_build_object('replay_idempotency_id',v_idem_id,'replay_key',v_key,'reason',p_reason,'replay_count',r.replay_count));

  update public.idempotency_keys
  set status='completed',response_code=200,
      response_payload=jsonb_build_object('execution_id',r.id,'status',r.status,'replay_count',r.replay_count),
      resource_id=r.id::text
  where id=v_idem_id;
  return r;
end;
$function$;

REVOKE ALL ON FUNCTION public.crm_replay_automation_execution(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_replay_automation_execution(uuid,text) TO authenticated;
