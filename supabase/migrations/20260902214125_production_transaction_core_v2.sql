create table if not exists public.gateway_webhook_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null,
 provider_event_id text not null,
 signature_timestamp timestamptz not null,
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'accepted' check (status in ('accepted','processing','processed','failed','dead_letter')),
 attempts integer not null default 0,
 last_error text,
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(provider, provider_event_id)
);
create index if not exists gateway_webhook_events_status_idx on public.gateway_webhook_events(status, received_at);
create index if not exists gateway_webhook_events_provider_idx on public.gateway_webhook_events(provider, received_at desc);
alter table public.gateway_webhook_events enable row level security;

create or replace function public.ingest_gateway_webhook(p_provider text,p_provider_event_id text,p_signature_timestamp timestamptz,p_payload jsonb)
returns table(duplicate boolean, webhook_id uuid)
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
 if coalesce(length(trim(p_provider)),0)=0 or coalesce(length(trim(p_provider_event_id)),0)=0 then raise exception 'provider_and_event_id_required'; end if;
 insert into public.gateway_webhook_events(provider,provider_event_id,signature_timestamp,payload)
 values(lower(trim(p_provider)),trim(p_provider_event_id),p_signature_timestamp,coalesce(p_payload,'{}'::jsonb))
 on conflict(provider,provider_event_id) do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from public.gateway_webhook_events where provider=lower(trim(p_provider)) and provider_event_id=trim(p_provider_event_id);
   return query select true,v_id;
 else return query select false,v_id; end if;
end $$;
revoke all on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) from public;
grant execute on function public.ingest_gateway_webhook(text,text,timestamptz,jsonb) to anon,authenticated,service_role;

create or replace function public.transition_gateway_transaction(p_transaction_id uuid,p_next_status text,p_error_message text default null)
returns public.gateway_transactions
language plpgsql security definer set search_path=public
as $$
declare v public.gateway_transactions; c text;
begin
 select status into c from public.gateway_transactions where id=p_transaction_id for update;
 if c is null then raise exception 'transaction_not_found'; end if;
 if c=p_next_status then select * into v from public.gateway_transactions where id=p_transaction_id; return v; end if;
 if c in ('approved','captured','refunded','cancelled','failed') then raise exception 'terminal_transaction_state'; end if;
 if p_next_status not in ('created','processing','pending','approved','captured','failed','cancelled','refunded') then raise exception 'invalid_transaction_state'; end if;
 if p_next_status='created' and c<>'created' then raise exception 'invalid_state_transition'; end if;
 if p_next_status='processing' and c not in ('created','pending') then raise exception 'invalid_state_transition'; end if;
 if p_next_status='pending' and c not in ('created','processing') then raise exception 'invalid_state_transition'; end if;
 if p_next_status='approved' and c not in ('processing','pending') then raise exception 'invalid_state_transition'; end if;
 if p_next_status='captured' and c<>'approved' then raise exception 'invalid_state_transition'; end if;
 if p_next_status='refunded' and c not in ('approved','captured') then raise exception 'invalid_state_transition'; end if;
 if p_next_status='cancelled' and c not in ('created','processing','pending','approved') then raise exception 'invalid_state_transition'; end if;
 if p_next_status='failed' and c not in ('created','processing','pending') then raise exception 'invalid_state_transition'; end if;
 update public.gateway_transactions set status=p_next_status,error_message=coalesce(p_error_message,error_message),completed_at=case when p_next_status in ('approved','captured','failed','cancelled','refunded') then coalesce(completed_at,now()) else completed_at end,updated_at=now() where id=p_transaction_id returning * into v;
 return v;
end $$;
revoke all on function public.transition_gateway_transaction(uuid,text,text) from public;
grant execute on function public.transition_gateway_transaction(uuid,text,text) to service_role,authenticated;

create or replace function public.record_gateway_health(p_gateway_id uuid,p_gateway_name text,p_success boolean,p_latency_ms integer default null)
returns public.gateway_health_snapshots
language plpgsql security definer set search_path=public
as $$
declare v public.gateway_health_snapshots; failures integer; state text;
begin
 select consecutive_failures into failures from public.gateway_health_snapshots where gateway_id=p_gateway_id order by checked_at desc limit 1;
 failures:=case when p_success then 0 else coalesce(failures,0)+1 end;
 state:=case when failures>=5 then 'open' when failures>=3 then 'half_open' else 'closed' end;
 insert into public.gateway_health_snapshots(gateway_id,gateway_name,is_healthy,latency_ms,consecutive_failures,circuit_state,details)
 values(p_gateway_id,p_gateway_name,p_success,p_latency_ms,failures,state,jsonb_build_object('source','transaction_core','threshold',5)) returning * into v;
 return v;
end $$;
revoke all on function public.record_gateway_health(uuid,text,boolean,integer) from public;
grant execute on function public.record_gateway_health(uuid,text,boolean,integer) to service_role;

create index if not exists gateway_transactions_idempotency_idx on public.gateway_transactions(user_id,idempotency_key) where idempotency_key is not null;
create index if not exists gateway_payment_attempts_tx_key_idx on public.gateway_payment_attempts(idempotency_key,created_at desc);
create index if not exists transaction_audit_events_type_created_idx on public.transaction_audit_events(event_type,created_at desc);
