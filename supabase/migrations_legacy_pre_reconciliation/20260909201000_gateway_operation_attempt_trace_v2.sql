create or replace function public.persist_gateway_attempt_operation_trace() returns trigger language plpgsql security definer set search_path=public as $$
declare v_routing jsonb; v_policy_id uuid; v_policy_version bigint;
begin
  if new.transaction_id is null or new.external_transaction_id is null then return new; end if;
  select coalesce(routing_metadata,'{}'::jsonb) into v_routing from public.gateway_transactions where id=new.transaction_id and user_id=new.user_id;
  begin v_policy_id:=(v_routing->>'policy_id')::uuid; exception when others then v_policy_id:=null; end;
  begin v_policy_version:=(v_routing->>'policy_version')::bigint; exception when others then v_policy_version:=null; end;
  insert into public.gateway_operation_logs(user_id,transaction_id,gateway_id,operation,status,attempt,request_meta,response_meta,error_message,routing_policy_id,routing_policy_version,decision_reason,provider_request_id,duration_ms)
  select new.user_id,new.transaction_id,new.gateway_id,'payment',new.status,coalesce(new.attempt_order,1),jsonb_build_object('idempotency_key',new.idempotency_key),jsonb_build_object('external_transaction_id',new.external_transaction_id,'failure_class',new.failure_class),new.error_message,v_policy_id,v_policy_version,coalesce(new.failure_class,'attempt'),new.external_transaction_id,null
  where not exists(select 1 from public.gateway_operation_logs l where l.user_id=new.user_id and l.transaction_id=new.transaction_id and l.gateway_id=new.gateway_id and l.provider_request_id=new.external_transaction_id and l.operation='payment');
  return new;
end;
$$;
drop trigger if exists trg_persist_gateway_attempt_operation_trace on public.gateway_payment_attempts;
create trigger trg_persist_gateway_attempt_operation_trace after insert or update of transaction_id on public.gateway_payment_attempts for each row execute function public.persist_gateway_attempt_operation_trace();
revoke execute on function public.persist_gateway_attempt_operation_trace() from public,anon,authenticated;
grant execute on function public.persist_gateway_attempt_operation_trace() to service_role;
