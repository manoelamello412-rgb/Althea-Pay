alter table public.idempotency_keys add column if not exists lease_token uuid;
alter table public.idempotency_keys add column if not exists lease_version bigint not null default 0;
create index if not exists idempotency_keys_processing_expiry_idx on public.idempotency_keys(status, expires_at) where status='processing';
drop function if exists public.reserve_idempotency_key(uuid,text,text,text,interval);
create function public.reserve_idempotency_key(p_user_id uuid,p_scope text,p_idempotency_key text,p_request_digest text,p_ttl interval default interval '24 hours') returns table(acquired boolean,id uuid,status text,response_code integer,response_payload jsonb,resource_type text,resource_id text,lease_token uuid) language plpgsql security definer set search_path=public,extensions as $function$
declare v public.idempotency_keys%rowtype; v_lease uuid;
begin
 if p_user_id is null or nullif(trim(p_scope),'') is null or nullif(trim(p_idempotency_key),'') is null then raise exception 'invalid_idempotency_arguments'; end if;
 if p_ttl <= interval '0 seconds' or p_ttl > interval '7 days' then raise exception 'invalid_idempotency_ttl'; end if;
 select * into v from public.idempotency_keys where user_id=p_user_id and scope=p_scope and idempotency_key=p_idempotency_key for update;
 if found then
  if v.expires_at <= now() then
   v_lease=gen_random_uuid();
   update public.idempotency_keys set status='processing',request_digest=p_request_digest,response_code=null,response_payload=null,response_digest=null,resource_type=null,resource_id=null,expires_at=now()+p_ttl,updated_at=now(),lease_token=v_lease,lease_version=coalesce(lease_version,0)+1 where id=v.id;
   return query select true,v.id,'processing'::text,null::integer,null::jsonb,null::text,null::text,v_lease; return;
  end if;
  if v.request_digest is not null and p_request_digest is not null and v.request_digest <> p_request_digest then raise exception 'idempotency_key_reused_with_different_request'; end if;
  return query select false,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; return;
 end if;
 v_lease=gen_random_uuid();
 begin
  insert into public.idempotency_keys(user_id,scope,idempotency_key,status,request_digest,expires_at,lease_token,lease_version) values(p_user_id,p_scope,p_idempotency_key,'processing',p_request_digest,now()+p_ttl,v_lease,1) returning * into v;
 exception when unique_violation then
  select * into v from public.idempotency_keys where user_id=p_user_id and scope=p_scope and idempotency_key=p_idempotency_key;
  if v.request_digest is not null and p_request_digest is not null and v.request_digest <> p_request_digest then raise exception 'idempotency_key_reused_with_different_request'; end if;
  return query select false,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token; return;
 end;
 return query select true,v.id,v.status,v.response_code,v.response_payload,v.resource_type,v.resource_id,v.lease_token;
end;$function$;
create or replace function public.complete_idempotency_key(p_id uuid,p_status text,p_response_code integer,p_response_payload jsonb,p_resource_type text default null,p_resource_id text default null,p_lease_token uuid default null) returns boolean language plpgsql security definer set search_path=public,extensions as $function$
begin
 if p_status not in ('completed','failed') then raise exception 'invalid_idempotency_status'; end if;
 update public.idempotency_keys set status=p_status,response_code=p_response_code,response_payload=p_response_payload,response_digest=encode(extensions.digest(convert_to(coalesce(p_response_payload,'null'::jsonb)::text,'UTF8'),'sha256'),'hex'),resource_type=p_resource_type,resource_id=p_resource_id,updated_at=now(),expires_at=case when p_status='completed' then greatest(expires_at,now()) else now() end where id=p_id and (p_lease_token is null or lease_token=p_lease_token) and status='processing';
 return found;
end;$function$;
revoke all on function public.reserve_idempotency_key(uuid,text,text,text,interval) from public,anon,authenticated;
revoke all on function public.complete_idempotency_key(uuid,text,integer,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_idempotency_key(uuid,text,text,text,interval) to service_role;
grant execute on function public.complete_idempotency_key(uuid,text,integer,jsonb,text,text,uuid) to service_role;