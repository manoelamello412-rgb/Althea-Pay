create or replace function public.gateway_attempt_decline_operator_event()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_user uuid; v_tx uuid; v_gateway text; v_provider text; v_msg text; v_cat text;
begin
 if NEW.status not in ('declined','error') or (TG_OP='UPDATE' and OLD.status=NEW.status and coalesce(OLD.error_message,'')=coalesce(NEW.error_message,'') and coalesce(OLD.response_code,'')=coalesce(NEW.response_code,'')) then return NEW; end if;
 select user_id,transaction_id,gateway_id into v_user,v_tx,v_gateway from public.gateway_payment_attempts where id=NEW.id;
 select provider into v_provider from public.gateways where id=NEW.gateway_id;
 v_cat=coalesce(NEW.failure_class,'unknown');
 v_msg=coalesce(nullif(NEW.error_message,''),case when NEW.response_code is not null then 'Gateway recusou a tentativa (código '||NEW.response_code||').' else 'Gateway recusou a tentativa.' end);
 insert into public.gateway_decline_details(user_id,transaction_id,attempt_id,gateway_id,provider,provider_code,category,safe_message,raw_error,provider_request_id)
 values(v_user,v_tx,v_gateway,v_gateway,v_provider,NEW.response_code,v_cat,v_msg,jsonb_build_object('error_message',NEW.error_message,'response_code',NEW.response_code,'failure_class',NEW.failure_class),NEW.provider_request_id);
 insert into public.gateway_operator_events(user_id,transaction_id,event_type,idempotency_key,payload)
 values(v_user,v_tx,'payment.declined','attempt-decline:'||NEW.id::text,jsonb_build_object('attempt_id',NEW.id,'gateway_id',v_gateway,'provider',v_provider,'response_code',NEW.response_code,'failure_class',v_cat,'message',v_msg,'provider_request_id',NEW.provider_request_id)) on conflict do nothing;
 return NEW;
end $$;
revoke all on function public.gateway_attempt_decline_operator_event() from public,anon,authenticated;
grant execute on function public.gateway_attempt_decline_operator_event() to service_role;
drop trigger if exists trg_gateway_attempt_decline_operator_event on public.gateway_payment_attempts;
create trigger trg_gateway_attempt_decline_operator_event after insert or update of status,error_message,response_code on public.gateway_payment_attempts for each row execute function public.gateway_attempt_decline_operator_event();

create or replace function public.gateway_transaction_operator_event()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_event text;
begin
 if NEW.status=OLD.status then return NEW; end if;
 v_event:=case when NEW.status='approved' then 'payment.approved' when NEW.status='pending' then 'payment.pending' when NEW.status='failed' then 'payment.failed' when NEW.status='refunded' then 'payment.refunded' when NEW.status='chargeback' then 'payment.chargeback' else 'payment.'||NEW.status end;
 insert into public.gateway_operator_events(user_id,funnel_id,transaction_id,event_type,idempotency_key,payload)
 values(NEW.user_id,NEW.funnel_id,NEW.id,v_event,'transaction-status:'||NEW.id::text||':'||NEW.version::text,jsonb_build_object('transaction_id',NEW.id,'status',NEW.status,'amount',NEW.amount,'currency',NEW.currency,'gateway_id',NEW.gateway_id,'external_id',NEW.external_id,'failure_code',NEW.failure_code,'version',NEW.version)) on conflict do nothing;
 return NEW;
end $$;
revoke all on function public.gateway_transaction_operator_event() from public,anon,authenticated;
grant execute on function public.gateway_transaction_operator_event() to service_role;
drop trigger if exists trg_gateway_transaction_operator_event on public.gateway_transactions;
create trigger trg_gateway_transaction_operator_event after update of status on public.gateway_transactions for each row execute function public.gateway_transaction_operator_event();
