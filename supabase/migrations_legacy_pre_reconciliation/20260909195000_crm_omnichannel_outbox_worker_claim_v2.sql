create or replace function public.crm_claim_channel_outbox_worker(p_limit integer default 25)
returns setof public.crm_channel_message_outbox
language plpgsql security definer set search_path=public
as $$
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 return query with claimed as (select id from public.crm_channel_message_outbox where status='queued' and (next_attempt_at is null or next_attempt_at<=now()) order by created_at for update skip locked limit greatest(1,least(p_limit,100))) update public.crm_channel_message_outbox o set status='processing',attempts=attempts+1,updated_at=now() from claimed c where o.id=c.id returning o.*;
end; $$;
revoke all on function public.crm_claim_channel_outbox_worker(integer) from public,anon,authenticated;
grant execute on function public.crm_claim_channel_outbox_worker(integer) to service_role;

create or replace function public.crm_requeue_stale_channel_outbox(p_age_minutes integer default 15)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
 update public.crm_channel_message_outbox set status='queued',next_attempt_at=now(),updated_at=now(),last_error=coalesce(last_error,'stale_processing_requeued') where status='processing' and updated_at < now() - make_interval(mins=>greatest(1,p_age_minutes)); get diagnostics n=row_count; return n;
end; $$;
revoke all on function public.crm_requeue_stale_channel_outbox(integer) from public,anon,authenticated;
grant execute on function public.crm_requeue_stale_channel_outbox(integer) to service_role;
