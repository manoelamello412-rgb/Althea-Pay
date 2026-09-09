create or replace function public.gateway_runtime_route_candidates(p_user_id uuid,p_gateway_ids text[],p_amount numeric,p_currency text,p_environment text)
returns table(gateway_id text,routing_score numeric,approval_rate numeric,latency_ms integer,healthy boolean,circuit_state text,cost_bps numeric)
language plpgsql security definer set search_path=public as $$
begin
 if p_user_id is null then raise exception 'gateway_user_required'; end if;
 if p_amount is null or p_amount <= 0 then raise exception 'gateway_amount_invalid'; end if;
 if p_currency is null or length(p_currency) <> 3 then raise exception 'gateway_currency_invalid'; end if;
 return query select * from public.rank_gateway_candidates(p_user_id,p_gateway_ids,p_amount,upper(p_currency),lower(p_environment));
end; $$;
revoke execute on function public.gateway_runtime_route_candidates(uuid,text[],numeric,text,text) from public,anon,authenticated;
grant execute on function public.gateway_runtime_route_candidates(uuid,text[],numeric,text,text) to service_role;

create or replace function public.enqueue_gateway_attempt_recovery()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.user_id is null or new.id is null then return new; end if;
 if lower(coalesce(new.failure_class,'')) in ('timeout','unknown','technical','unavailable')
    and lower(coalesce(new.status,'')) in ('error','failed','pending') then
   insert into public.gateway_recovery_queue
     (user_id,attempt_id,transaction_id,gateway_id,provider,idempotency_key,failure_class,external_transaction_id,status,attempts,next_retry_at,last_error)
   select new.user_id,new.id,new.transaction_id,new.gateway_id,coalesce(new.gateway_name,''),new.idempotency_key,
          new.failure_class,new.external_transaction_id,'queued',0,now(),new.error_message
   where not exists (select 1 from public.gateway_recovery_queue q where q.user_id=new.user_id and q.attempt_id=new.id and q.status in ('queued','processing'));
 end if;
 return new;
end; $$;
revoke execute on function public.enqueue_gateway_attempt_recovery() from public,anon,authenticated;
grant execute on function public.enqueue_gateway_attempt_recovery() to service_role;
drop trigger if exists trg_enqueue_gateway_attempt_recovery on public.gateway_payment_attempts;
create trigger trg_enqueue_gateway_attempt_recovery
after insert or update of status,failure_class,external_transaction_id,transaction_id on public.gateway_payment_attempts
for each row execute function public.enqueue_gateway_attempt_recovery();

create or replace function public.gateway_token_link_runtime_context(p_link_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record;
begin
 if p_link_id is null or p_user_id is null then raise exception 'gateway_token_context_required'; end if;
 select l.id,l.user_id,l.instrument_id,l.gateway_id,l.provider,l.status,l.token_fingerprint into r
 from public.gateway_payment_token_links l where l.id=p_link_id and l.user_id=p_user_id and l.status='active';
 if not found then raise exception 'gateway_payment_token_link_not_found'; end if;
 return jsonb_build_object('link_id',r.id,'instrument_id',r.instrument_id,'gateway_id',r.gateway_id,'provider',r.provider,'status',r.status,'token_fingerprint',r.token_fingerprint);
end; $$;
revoke execute on function public.gateway_token_link_runtime_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gateway_token_link_runtime_context(uuid,uuid) to service_role;

create or replace function public.gateway_attempt_trace_enforce_policy_authority()
returns trigger language plpgsql security definer set search_path=public as $$
declare p record;
begin
 if new.routing_policy_id is not null then
   select id,version,user_id into p from public.gateway_routing_policies where id=new.routing_policy_id and user_id=new.user_id and is_active=true;
   if not found then raise exception 'gateway_attempt_routing_policy_invalid'; end if;
   if new.routing_policy_version is null or new.routing_policy_version <> p.version then raise exception 'gateway_attempt_routing_policy_version_mismatch'; end if;
 end if;
 return new;
end; $$;
revoke execute on function public.gateway_attempt_trace_enforce_policy_authority() from public,anon,authenticated;
grant execute on function public.gateway_attempt_trace_enforce_policy_authority() to service_role;
drop trigger if exists trg_gateway_attempt_trace_policy_authority on public.gateway_payment_attempts;
create trigger trg_gateway_attempt_trace_policy_authority
before insert or update of routing_policy_id,routing_policy_version,user_id on public.gateway_payment_attempts
for each row execute function public.gateway_attempt_trace_enforce_policy_authority();
