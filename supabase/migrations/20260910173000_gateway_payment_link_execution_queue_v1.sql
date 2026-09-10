create table if not exists public.gateway_payment_link_execution_commands (
  id uuid primary key default gen_random_uuid(),
  payment_link_id uuid not null references public.gateway_payment_links(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  gateway_id text not null,
  action text not null default 'create_payment_link' check (action='create_payment_link'),
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key)
);

create index if not exists idx_gateway_payment_link_execution_commands_ready on public.gateway_payment_link_execution_commands(status,available_at,created_at);
create index if not exists idx_gateway_payment_link_execution_commands_payment_link on public.gateway_payment_link_execution_commands(payment_link_id);

alter table public.gateway_payment_link_execution_commands enable row level security;

create or replace function public.enqueue_gateway_payment_link_execution(
 p_user_id uuid,
 p_payment_link_id uuid,
 p_gateway_id text,
 p_idempotency_key text,
 p_request_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare r public.gateway_payment_link_execution_commands;
begin
 if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'AUTHORIZATION_DENIED'; end if;
 select * into r from public.gateway_payment_link_execution_commands where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
 if found then return jsonb_build_object('id',r.id,'status',r.status,'payment_link_id',r.payment_link_id,'idempotency_key',r.idempotency_key,'attempt_count',r.attempt_count,'result',r.result_payload); end if;
 insert into public.gateway_payment_link_execution_commands(user_id,payment_link_id,gateway_id,idempotency_key,request_payload)
 values(p_user_id,p_payment_link_id,p_gateway_id,p_idempotency_key,coalesce(p_request_payload,'{}'::jsonb)) returning * into r;
 return jsonb_build_object('id',r.id,'status',r.status,'payment_link_id',r.payment_link_id,'idempotency_key',r.idempotency_key,'attempt_count',r.attempt_count);
end $$;

create or replace function public.claim_gateway_payment_link_execution(p_worker_id text,p_limit integer default 10)
returns setof public.gateway_payment_link_execution_commands
language plpgsql security definer set search_path=public
as $$
begin
 if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 return query
 with picked as (
   select id from public.gateway_payment_link_execution_commands
   where (status='queued' and available_at<=now())
      or (status='processing' and available_at<=now() and locked_at < now()-interval '5 minutes')
   order by available_at,created_at
   for update skip locked limit greatest(1,least(coalesce(p_limit,10),100))
 )
 update public.gateway_payment_link_execution_commands c
 set status='processing',attempt_count=c.attempt_count+1,locked_at=now(),locked_by=p_worker_id,updated_at=now()
 from picked where c.id=picked.id returning c.*;
end $$;

create or replace function public.complete_gateway_payment_link_execution(p_command_id uuid,p_result_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare r public.gateway_payment_link_execution_commands;
begin
 if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 update public.gateway_payment_link_execution_commands set status='completed',result_payload=coalesce(p_result_payload,'{}'::jsonb),completed_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=p_command_id returning * into r;
 if not found then raise exception 'COMMAND_NOT_FOUND'; end if;
 return jsonb_build_object('id',r.id,'status',r.status,'result',r.result_payload);
end $$;

create or replace function public.fail_gateway_payment_link_execution(p_command_id uuid,p_error_code text,p_error_message text,p_retryable boolean default true,p_retry_seconds integer default 30)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare r public.gateway_payment_link_execution_commands;
begin
 if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 update public.gateway_payment_link_execution_commands
 set status=case when p_retryable then 'queued' else 'failed' end,
     available_at=case when p_retryable then now()+make_interval(secs=>greatest(1,least(coalesce(p_retry_seconds,30),86400))) else available_at end,
     last_error_code=left(coalesce(p_error_code,'EXECUTION_FAILED'),120),
     last_error_message=left(coalesce(p_error_message,'Execution failed'),1000),
     locked_at=null,locked_by=null,updated_at=now()
 where id=p_command_id returning * into r;
 if not found then raise exception 'COMMAND_NOT_FOUND'; end if;
 return jsonb_build_object('id',r.id,'status',r.status,'attempt_count',r.attempt_count,'retryable',p_retryable,'error_code',r.last_error_code);
end $$;

revoke all on function public.enqueue_gateway_payment_link_execution(uuid,uuid,text,text,jsonb) from public;
grant execute on function public.enqueue_gateway_payment_link_execution(uuid,uuid,text,text,jsonb) to authenticated;
revoke all on function public.claim_gateway_payment_link_execution(text,integer) from public;
grant execute on function public.claim_gateway_payment_link_execution(text,integer) to service_role;
revoke all on function public.complete_gateway_payment_link_execution(uuid,jsonb) from public;
grant execute on function public.complete_gateway_payment_link_execution(uuid,jsonb) to service_role;
revoke all on function public.fail_gateway_payment_link_execution(uuid,text,text,boolean,integer) from public;
grant execute on function public.fail_gateway_payment_link_execution(uuid,text,text,boolean,integer) to service_role;

create or replace trigger gateway_payment_link_execution_commands_updated_at before update on public.gateway_payment_link_execution_commands for each row execute function set_updated_at_gateway_core();
